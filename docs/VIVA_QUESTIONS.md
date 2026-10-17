# Viva Questions and Answers

**1. What is the difference between preemptive and non-preemptive scheduling?** Non-preemptive: a process keeps the resource until it finishes (runway module). Preemptive: the scheduler may take the resource away when a better candidate arrives or a time slice ends (baggage, maintenance).

**2. How are waiting, turnaround and response time computed here?** Turnaround = completion - arrival; waiting = turnaround - burst; response = first start - arrival.

**3. Why do FCFS runs show response time = waiting time?** The process runs once without interruption, so it waits only before its first and only start.

**4. What is the convoy effect?** A long job at the front delays all short jobs behind it, raising average waiting time (see the FCFS textbook test: average waiting 16).

**5. Why is SRTF optimal for average waiting time, and what is its drawback?** Always running the least remaining work minimises average waiting among preemptive schedules; it can starve long jobs and needs burst knowledge.

**6. How is starvation possible in priority scheduling, and what is the cure?** Low-priority processes may wait forever if urgent work keeps arriving; aging gradually raises the priority of waiting processes (not implemented here; listed as future scope).

**7. How does Round Robin depend on the time quantum?** A very large quantum behaves like FCFS; a very small one adds context-switch overhead. The tests cover quantum 1 and quantum > burst.

**8. In Round Robin, who queues first: a newly arrived process or the preempted one?** The new arrival, then the preempted process (implemented and tested).

**9. What are the four conditions for deadlock?** Mutual exclusion, hold and wait, no preemption, circular wait.

**10. What is a safe state?** A state where some order of finishing all processes exists, each getting its maximum from Available plus what earlier processes release. That order is a safe sequence.

**11. Is an unsafe state a deadlock?** No. It means deadlock is possible. The system reports `DENIED_UNSAFE` rather than "deadlock".

**12. Write the Need formula.** Need[i][j] = Max[i][j] - Allocation[i][j].

**13. Walk through a Banker's request.** Check Request <= Need, then <= Available, tentatively allocate, run safety; commit if safe, otherwise roll back.

**14. Avoidance vs detection?** Avoidance (Banker's) refuses risky requests up front but needs maximum demands. Detection allows anything and later analyses Allocation + outstanding Requests to find deadlocked processes.

**15. Why does detection treat processes holding nothing as finished?** They cannot be part of a circular wait, and they are not blocking anyone.

**16. How is a deadlock recovered here?** By controlled release or by terminating a simulated process (confirmation required); the resources are returned, the action is logged, and detection is re-run.

**17. Why is MySQL the authority for allocations?** Many clients may request at once; only the database can serialise changes. The frontend never decides.

**18. How are concurrent requests kept safe?** Each operation runs in a transaction that locks all `resource_types` rows with `SELECT ... FOR UPDATE` in ascending id order, reads a snapshot, runs the algorithm, writes and commits. Same lock order means no lock-ordering deadlock; a stale calculation cannot overwrite a newer allocation.

**19. What database deadlock could occur and how is it avoided?** Two transactions locking rows in opposite orders. A fixed global lock order prevents it.

**20. What are ACID properties and where do they matter here?** Atomicity: a grant updates allocations, counters and the log together or not at all. Consistency: CHECK constraints keep `0 <= allocated <= total`. Isolation: row locks. Durability: committed allocations survive restarts.

**21. Why a generated column for `available_instances`?** Available = Total - Allocated is derived data; generating it prevents it from drifting out of sync.

**22. Why store matrices as rows `(process, resource, value)`?** It is normalised: adding a resource type needs no schema change and constraints apply per cell.

**23. Why run algorithms as C++ child processes?** Demonstrates language integration and keeps algorithms independent and testable. Safety measures: fixed allow-list, no shell, timeout, output size cap, validation both in Node and C++.

**24. How do you prevent SQL injection?** Parameterised queries everywhere; table and column names come from server-side config, never from user input.

**25. What does `FOR UPDATE` do under InnoDB?** It takes exclusive row locks until the transaction ends, blocking other writers (and other `FOR UPDATE` readers) on those rows.

**26. How is idle time handled in the schedulers?** If nothing has arrived, an `IDLE` slice is recorded until the next arrival.

**27. How are ties handled?** Smaller key, then earlier arrival, then input order, so results are deterministic.

**28. Time complexity of the safety algorithm?** O(n^2 m) for n processes and m resource types.
