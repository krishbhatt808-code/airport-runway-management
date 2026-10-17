#include "include/scheduler.h"

using namespace std;

// Runs the maintenance scheduler, which supports preemptive Priority and Round Robin.
int main() {
    return runSchedulerProgram({"PRIORITY_P", "RR"});
}