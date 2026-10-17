#include "include/scheduler.h"

using namespace std;

// Runs the baggage scheduler, which supports SRTF and preemptive Priority.
int main() {
    return runSchedulerProgram({"SRTF", "PRIORITY_P"});
}