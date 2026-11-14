#include "include/scheduler.h"

using namespace std;

// Runs the runway scheduler, which supports FCFS and non-preemptive Priority.
int main() {
    return runSchedulerProgram({"FCFS", "PRIORITY_NP"});
}