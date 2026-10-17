#include "include/resources.h"

using namespace std;

// Prints the detection result as one JSON object and returns 0.
static int emit(const string& result, const string& explanation, const vector<string>& finishable,
                const vector<string>& unfinished, const Vec& work) {
    cout << "{\"result\":" << q(result)
         << ",\"explanation\":" << q(explanation)
         << ",\"finishable\":" << strArr(finishable)
         << ",\"unfinished\":" << strArr(unfinished)
         << ",\"finalWork\":" << intArr(work) << "}" << endl;
    return 0;
}

// Runs the detection algorithm and fills the finishable and unfinished (deadlocked) process names.
static void detect(const State& s, const vector<string>& names, Vec& work,
                   vector<string>& finishable, vector<string>& unfinished) {
    size_t n = s.allocation.size();
    vector<bool> finished(n, false);
    work = s.available;

    for (size_t i = 0; i < n; i++) {
        bool holdsNothing = true;
        for (long long x : s.allocation[i]) {
            if (x > 0) {
                holdsNothing = false;
            }
        }
        if (holdsNothing) {
            finished[i] = true;
            finishable.push_back(names[i]);
        }
    }

    bool progress = true;
    while (progress) {
        progress = false;
        for (size_t i = 0; i < n; i++) {
            if (!finished[i] && leq(s.request[i], work)) {
                addTo(work, s.allocation[i]);
                finished[i] = true;
                finishable.push_back(names[i]);
                progress = true;
            }
        }
    }

    for (size_t i = 0; i < n; i++) {
        if (!finished[i]) {
            unfinished.push_back(names[i]);
        }
    }
}

// Reads the resource state from standard input, validates it and reports whether a deadlock exists.
int main() {
    try {
        Json in = readInput();
        if (!in.has("available") || !in.has("allocation") || !in.has("request")) {
            return emit("INSUFFICIENT_INFORMATION", "Available, Allocation and Request data are all required.", {}, {}, {});
        }

        State s;
        string error = readVec(in.at("available"), s.available);
        if (error.empty()) {
            error = readMat(in.at("allocation"), s.allocation);
        }
        if (error.empty()) {
            error = readMat(in.at("request"), s.request);
        }
        if (!error.empty()) {
            return emit("INVALID_STATE", error, {}, {}, {});
        }

        size_t n = s.allocation.size();
        size_t m = s.available.size();
        if (!nonNegative(s.available)) {
            return emit("INVALID_STATE", "Available contains negative values.", {}, {}, {});
        }
        error = checkShape(s.allocation, n, m, "Allocation");
        if (error.empty()) {
            error = checkShape(s.request, n, m, "Request");
        }
        if (!error.empty()) {
            return emit("INVALID_STATE", error, {}, {}, {});
        }
        if (n == 0 || m == 0) {
            return emit("INSUFFICIENT_INFORMATION",
                        "There are no processes or no resource types, so a meaningful check is impossible.", {}, {}, s.available);
        }

        vector<string> names = readNames(in, n);
        Vec work;
        vector<string> finishable, unfinished;
        detect(s, names, work, finishable, unfinished);

        if (unfinished.empty()) {
            return emit("NO_DEADLOCK", "Every process can obtain its outstanding request and finish. No deadlock detected.",
                        finishable, unfinished, work);
        }
        return emit("DEADLOCK",
                    "These processes hold resources and wait for requests that can never be satisfied by the processes that can still finish.",
                    finishable, unfinished, work);
    } catch (const exception& e) {
        return fail(e.what());
    }
}