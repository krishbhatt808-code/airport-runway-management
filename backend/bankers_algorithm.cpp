#include <algorithm>
#include "include/resources.h"

using namespace std;

struct Bank {
    Vec available;
    Mat allocation, maxDemand, need;
    vector<string> names;
};

// Safety algorithm: returns true and fills 'sequence' when every process can finish.
static bool safetySequence(Vec work, const Mat& allocation, const Mat& need, vector<int>& sequence) {
    size_t n = allocation.size();
    vector<bool> finished(n, false);
    bool progress = true;
    while (progress) {
        progress = false;
        for (size_t i = 0; i < n; i++) {
            if (!finished[i] && leq(need[i], work)) {
                addTo(work, allocation[i]);
                finished[i] = true;
                sequence.push_back((int)i);
                progress = true;
            }
        }
    }
    return sequence.size() == n;
}

// Reads and validates the state, then computes Need = Max - Allocation; returns an error message or "".
static string loadBank(const Json& in, Bank& bank) {
    string error = readVec(in.at("available"), bank.available);
    if (error.empty()) {
        error = readMat(in.at("allocation"), bank.allocation);
    }
    if (error.empty()) {
        error = readMat(in.at("max"), bank.maxDemand);
    }
    if (!error.empty()) {
        return error;
    }

    size_t n = bank.allocation.size();
    size_t m = bank.available.size();
    if (!nonNegative(bank.available)) {
        return "available must not contain negative values";
    }
    error = checkShape(bank.allocation, n, m, "allocation");
    if (!error.empty()) {
        return error;
    }
    error = checkShape(bank.maxDemand, n, m, "max");
    if (!error.empty()) {
        return error;
    }

    bank.names = readNames(in, n);
    bank.need.assign(n, Vec(m, 0));
    for (size_t i = 0; i < n; i++) {
        for (size_t j = 0; j < m; j++) {
            if (bank.allocation[i][j] > bank.maxDemand[i][j]) {
                return "inconsistent state: allocation exceeds maximum for " + bank.names[i];
            }
            bank.need[i][j] = bank.maxDemand[i][j] - bank.allocation[i][j];
        }
    }
    return "";
}

// Decides a resource request; 'after' must start as a copy of 'bank' and is rolled back unless the request is granted.
static string decideRequest(const Bank& bank, long long p, const Vec& request, Bank& after,
                            vector<int>& sequence, bool& safe, string& explanation) {
    if (p < 0 || p >= (long long)bank.names.size()) {
        explanation = "Unknown process index.";
        return "INVALID";
    }
    if (request.size() != bank.available.size() || !nonNegative(request)) {
        explanation = "Request must be a non-negative vector with one entry per resource type.";
        return "INVALID";
    }
    if (all_of(request.begin(), request.end(), [](long long x) { return x == 0; })) {
        explanation = "Request is all zeros; nothing to allocate.";
        return "INVALID";
    }
    const string& name = bank.names[p];
    if (!leq(request, bank.need[p])) {
        explanation = name + " asked for more than its remaining Need (it would exceed its declared maximum).";
        return "DENIED_EXCEEDS_MAX";
    }
    if (!leq(request, bank.available)) {
        explanation = "Not enough free instances; " + name + " must wait.";
        return "DENIED_EXCEEDS_AVAILABLE";
    }

    subFrom(after.available, request);
    addTo(after.allocation[p], request);
    subFrom(after.need[p], request);
    safe = safetySequence(after.available, after.allocation, after.need, sequence);
    if (safe) {
        explanation = "Request granted: the resulting state is safe.";
        return "GRANTED";
    }

    after = bank;
    sequence.clear();
    explanation = "Request is legal and resources are free, but granting it would leave an unsafe state. "
                  "Rolled back. Unsafe does not mean deadlocked.";
    return "DENIED_UNSAFE";
}

// Prints the decision, the safe sequence and the matrices as one JSON object.
static void printResult(const string& decision, bool safe, const vector<int>& sequence,
                        const string& explanation, const Bank& before, const Bank& after) {
    vector<string> sequenceNames;
    for (int i : sequence) {
        sequenceNames.push_back(before.names[i]);
    }
    cout << "{\"decision\":" << q(decision)
         << ",\"safe\":" << (safe ? "true" : "false")
         << ",\"safeSequence\":" << strArr(sequenceNames)
         << ",\"explanation\":" << q(explanation)
         << ",\"need\":" << matrix(before.need)
         << ",\"newAvailable\":" << intArr(after.available)
         << ",\"newAllocation\":" << matrix(after.allocation)
         << ",\"newNeed\":" << matrix(after.need) << "}" << endl;
}

// Reads the state from standard input and runs either the safety check or a resource request.
int main() {
    try {
        Json in = readInput();
        Bank bank;
        string error = loadBank(in, bank);
        if (!error.empty()) {
            return fail(error);
        }

        string action = in.has("action") ? in.at("action").str : "safety";
        Bank after = bank;
        vector<int> sequence;
        string decision, explanation;
        bool safe = false;

        if (action == "safety") {
            safe = safetySequence(bank.available, bank.allocation, bank.need, sequence);
            decision = safe ? "SAFE" : "UNSAFE";
            explanation = safe ? "A safe sequence exists, so all processes can finish."
                               : "No safe sequence exists. The state is unsafe (deadlock is possible but not certain).";
        } else if (action == "request") {
            if (!in.has("processIndex") || !in.at("processIndex").isInt()) {
                return fail("processIndex is required");
            }
            Vec request;
            error = readVec(in.at("request"), request);
            if (!error.empty()) {
                return fail(error);
            }
            long long p = (long long)in.at("processIndex").num;
            decision = decideRequest(bank, p, request, after, sequence, safe, explanation);
        } else {
            return fail("action must be 'safety' or 'request'");
        }

        printResult(decision, safe, sequence, explanation, bank, after);
        return 0;
    } catch (const exception& e) {
        return fail(e.what());
    }
}