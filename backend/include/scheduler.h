#pragma once
#include <algorithm>
#include <deque>
#include <set>
#include <tuple>
#include "minijson.h"

using namespace std;

struct Proc {
    string id;
    long long arrival, burst, priority, index;
    long long remaining, start = -1, completion = 0;
};

struct Slice {
    string id;
    long long start, end;
};

struct Averages {
    double waiting = 0, turnaround = 0, response = 0;
    long long totalTime = 0;
};

// Checks one process object and returns an error message, or an empty string when it is valid.
inline string validateProcess(const Json& p, const set<string>& seen) {
    if (p.type != Json::Obj) {
        return "each process must be an object";
    }
    for (const char* key : {"id", "arrival", "burst", "priority"}) {
        if (!p.has(key)) {
            return string("process is missing '") + key + "'";
        }
    }
    if (p.at("id").type != Json::Str || p.at("id").str.empty()) {
        return "process id must be a non-empty string";
    }
    const string& id = p.at("id").str;
    if (seen.count(id)) {
        return "duplicate process id '" + id + "'";
    }
    if (!p.at("arrival").isInt() || p.at("arrival").num < 0) {
        return "arrival must be an integer >= 0 (" + id + ")";
    }
    if (!p.at("burst").isInt() || p.at("burst").num < 1) {
        return "burst must be an integer >= 1 (" + id + ")";
    }
    if (!p.at("priority").isInt()) {
        return "priority must be an integer (" + id + ")";
    }
    return "";
}

// Validates the "processes" array and fills the list; returns an error message or "".
inline string loadProcesses(const Json& in, vector<Proc>& out) {
    if (!in.has("processes") || in.at("processes").type != Json::Arr) {
        return "'processes' must be an array";
    }
    if (in.at("processes").arr.size() > 1000) {
        return "too many processes (max 1000)";
    }
    set<string> seen;
    long long index = 0;
    for (const Json& p : in.at("processes").arr) {
        string error = validateProcess(p, seen);
        if (!error.empty()) {
            return error;
        }
        Proc proc;
        proc.id = p.at("id").str;
        proc.arrival = (long long)p.at("arrival").num;
        proc.burst = (long long)p.at("burst").num;
        proc.priority = (long long)p.at("priority").num;
        proc.index = index++;
        proc.remaining = proc.burst;
        seen.insert(proc.id);
        out.push_back(proc);
    }
    return "";
}

// Adds a Gantt block and merges it with the previous block when it is the same process.
inline void addSlice(vector<Slice>& gantt, const string& id, long long start, long long end) {
    if (start >= end) {
        return;
    }
    if (!gantt.empty() && gantt.back().id == id && gantt.back().end == start) {
        gantt.back().end = end;
    } else {
        gantt.push_back({id, start, end});
    }
}

// Picks the next ready process by (algorithm key, arrival, input order); returns -1 if none is ready.
inline int pickNext(const vector<Proc>& ps, long long time, const string& algo) {
    auto key = [&](const Proc& p) {
        long long primary = (algo == "FCFS") ? p.arrival : (algo == "SRTF") ? p.remaining : p.priority;
        return make_tuple(primary, p.arrival, p.index);
    };
    int best = -1;
    for (size_t i = 0; i < ps.size(); i++) {
        if (ps[i].remaining <= 0 || ps[i].arrival > time) {
            continue;
        }
        if (best < 0 || key(ps[i]) < key(ps[best])) {
            best = (int)i;
        }
    }
    return best;
}

// Returns the earliest arrival time of a process that has not finished (or not been queued) yet.
inline long long nextArrival(const vector<Proc>& ps, const vector<bool>* queued) {
    long long earliest = -1;
    for (size_t i = 0; i < ps.size(); i++) {
        bool pending = queued ? !(*queued)[i] : ps[i].remaining > 0;
        if (pending && (earliest < 0 || ps[i].arrival < earliest)) {
            earliest = ps[i].arrival;
        }
    }
    return earliest;
}

// Simulates Round Robin with a fixed time quantum and fills in start/completion times.
inline void simulateRoundRobin(vector<Proc>& ps, long long quantum, vector<Slice>& gantt) {
    long long time = 0;
    long long unfinished = (long long)ps.size();
    deque<int> ready;
    vector<bool> queued(ps.size(), false);

    auto admit = [&](long long until) {
        vector<int> arrived;
        for (size_t i = 0; i < ps.size(); i++) {
            if (!queued[i] && ps[i].arrival <= until) {
                arrived.push_back((int)i);
            }
        }
        sort(arrived.begin(), arrived.end(), [&](int a, int b) {
            return tie(ps[a].arrival, ps[a].index) < tie(ps[b].arrival, ps[b].index);
        });
        for (int i : arrived) {
            ready.push_back(i);
            queued[i] = true;
        }
    };

    admit(0);
    while (unfinished > 0) {
        if (ready.empty()) {
            long long wakeUp = nextArrival(ps, &queued);
            addSlice(gantt, "IDLE", time, wakeUp);
            time = wakeUp;
            admit(time);
            continue;
        }
        int i = ready.front();
        ready.pop_front();
        if (ps[i].start < 0) {
            ps[i].start = time;
        }
        long long run = min(quantum, ps[i].remaining);
        addSlice(gantt, ps[i].id, time, time + run);
        time += run;
        ps[i].remaining -= run;
        admit(time);
        if (ps[i].remaining > 0) {
            ready.push_back(i);
        } else {
            ps[i].completion = time;
            unfinished--;
        }
    }
}

// Simulates FCFS, PRIORITY_NP, SRTF, PRIORITY_P or RR and builds the Gantt chart.
inline void simulate(vector<Proc>& ps, const string& algo, long long quantum, vector<Slice>& gantt) {
    if (algo == "RR") {
        simulateRoundRobin(ps, quantum, gantt);
        return;
    }
    bool preemptive = (algo == "SRTF" || algo == "PRIORITY_P");
    long long time = 0;
    long long unfinished = (long long)ps.size();

    while (unfinished > 0) {
        int i = pickNext(ps, time, algo);
        if (i < 0) {
            long long wakeUp = nextArrival(ps, nullptr);
            addSlice(gantt, "IDLE", time, wakeUp);
            time = wakeUp;
            continue;
        }
        if (ps[i].start < 0) {
            ps[i].start = time;
        }
        long long run = preemptive ? 1 : ps[i].remaining;
        addSlice(gantt, ps[i].id, time, time + run);
        time += run;
        ps[i].remaining -= run;
        if (ps[i].remaining == 0) {
            ps[i].completion = time;
            unfinished--;
        }
    }
}

// Builds the per-process results as JSON and computes the averages and total time.
inline string resultsJson(const vector<Proc>& ps, Averages& avg) {
    string json = "[";
    double sumWaiting = 0, sumTurnaround = 0, sumResponse = 0;
    for (size_t i = 0; i < ps.size(); i++) {
        const Proc& p = ps[i];
        long long turnaround = p.completion - p.arrival;
        long long waiting = turnaround - p.burst;
        long long response = p.start - p.arrival;
        sumWaiting += waiting;
        sumTurnaround += turnaround;
        sumResponse += response;
        avg.totalTime = max(avg.totalTime, p.completion);

        json += string(i ? "," : "") + "{\"id\":" + q(p.id) +
                ",\"arrival\":" + to_string(p.arrival) +
                ",\"burst\":" + to_string(p.burst) +
                ",\"priority\":" + to_string(p.priority) +
                ",\"start\":" + to_string(p.start) +
                ",\"completion\":" + to_string(p.completion) +
                ",\"turnaround\":" + to_string(turnaround) +
                ",\"waiting\":" + to_string(waiting) +
                ",\"response\":" + to_string(response) + "}";
    }
    double count = ps.empty() ? 1 : (double)ps.size();
    avg.waiting = sumWaiting / count;
    avg.turnaround = sumTurnaround / count;
    avg.response = sumResponse / count;
    return json + "]";
}

// Converts the Gantt chart into a JSON array of {id, start, end} blocks.
inline string ganttJson(const vector<Slice>& gantt) {
    string json = "[";
    for (size_t i = 0; i < gantt.size(); i++) {
        json += string(i ? "," : "") + "{\"id\":" + q(gantt[i].id) +
                ",\"start\":" + to_string(gantt[i].start) +
                ",\"end\":" + to_string(gantt[i].end) + "}";
    }
    return json + "]";
}

// Lists the processes in execution order (idle time is left out) as a JSON array.
inline string sequenceJson(const vector<Slice>& gantt) {
    vector<string> ids;
    for (const Slice& s : gantt) {
        if (s.id != "IDLE") {
            ids.push_back(s.id);
        }
    }
    return strArr(ids);
}

// Reads the request, runs the chosen algorithm and prints the result; 'allowed' lists the supported algorithms.
inline int runSchedulerProgram(const vector<string>& allowed) {
    try {
        Json in = readInput();
        if (in.type != Json::Obj) {
            return fail("input must be a JSON object");
        }
        string algo = (in.has("algorithm") && in.at("algorithm").type == Json::Str) ? in.at("algorithm").str : "";
        if (find(allowed.begin(), allowed.end(), algo) == allowed.end()) {
            string list;
            for (const string& a : allowed) {
                list += (list.empty() ? "" : ", ") + a;
            }
            return fail("unsupported algorithm '" + algo + "'; allowed: " + list);
        }

        long long quantum = 0;
        if (algo == "RR") {
            if (!in.has("quantum") || !in.at("quantum").isInt() || in.at("quantum").num < 1 || in.at("quantum").num > 1000) {
                return fail("quantum must be an integer between 1 and 1000");
            }
            quantum = (long long)in.at("quantum").num;
        }

        vector<Proc> ps;
        string error = loadProcesses(in, ps);
        if (!error.empty()) {
            return fail(error);
        }

        vector<Slice> gantt;
        simulate(ps, algo, quantum, gantt);

        Averages avg;
        string results = resultsJson(ps, avg);
        cout << "{\"algorithm\":" << q(algo)
             << ",\"quantum\":" << quantum
             << ",\"results\":" << results
             << ",\"gantt\":" << ganttJson(gantt)
             << ",\"sequence\":" << sequenceJson(gantt)
             << ",\"averages\":{\"waiting\":" << num(avg.waiting)
             << ",\"turnaround\":" << num(avg.turnaround)
             << ",\"response\":" << num(avg.response)
             << "},\"totalTime\":" << avg.totalTime << "}" << endl;
        return 0;
    } catch (const exception& e) {
        return fail(e.what());
    }
}