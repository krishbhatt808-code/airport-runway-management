-- Reproducible GENUINE DEADLOCK (demo scenario 4). Replaces the current resource state; run after schema.sql.
-- Cycle: P0 holds Diagnostic, waits Baggage(held by P1); P1 holds Baggage, waits Ground-Support (held by P2);
--        P2 holds Ground-Support + a Bay, waits Diagnostic (held by P0). P3 holds nothing.
USE airport_runway_db;

START TRANSACTION;

DELETE FROM processes;
-- cascades to max_demands, allocations, outstanding_requests
DELETE FROM resource_types;

INSERT INTO
    resource_types (
        resource_id,
        name,
        total_instances,
        allocated_instances
    )
VALUES (1, 'Maintenance Bays', 2, 2),
    (
        2,
        'Diagnostic Equipment',
        1,
        1
    ),
    (
        3,
        'Baggage Sorting Stations',
        1,
        1
    ),
    (
        4,
        'Ground-Support Equipment',
        1,
        1
    );

INSERT INTO
    processes (process_id, name, description)
VALUES (
        1,
        'P0',
        'Engine overhaul crew'
    ),
    (
        2,
        'P1',
        'Baggage reroute crew'
    ),
    (
        3,
        'P2',
        'Cargo transfer crew'
    ),
    (4, 'P3', 'Idle crew');

INSERT INTO
    allocations (
        process_id,
        resource_id,
        units
    )
VALUES (1, 1, 1),
    (1, 2, 1),
    (1, 3, 0),
    (1, 4, 0),
    (2, 1, 0),
    (2, 2, 0),
    (2, 3, 1),
    (2, 4, 0),
    (3, 1, 1),
    (3, 2, 0),
    (3, 3, 0),
    (3, 4, 1),
    (4, 1, 0),
    (4, 2, 0),
    (4, 3, 0),
    (4, 4, 0);

INSERT INTO
    outstanding_requests (
        process_id,
        resource_id,
        units
    )
VALUES (1, 1, 0),
    (1, 2, 0),
    (1, 3, 1),
    (1, 4, 0),
    (2, 1, 0),
    (2, 2, 0),
    (2, 3, 0),
    (2, 4, 1),
    (3, 1, 0),
    (3, 2, 1),
    (3, 3, 0),
    (3, 4, 0),
    (4, 1, 0),
    (4, 2, 0),
    (4, 3, 0),
    (4, 4, 0);

INSERT INTO
    max_demands (
        process_id,
        resource_id,
        max_units
    )
SELECT a.process_id, a.resource_id, a.units + r.units
FROM
    allocations a
    JOIN outstanding_requests r ON r.process_id = a.process_id
    AND r.resource_id = a.resource_id;

COMMIT;
-- Then call POST /api/deadlock/detect (or press "Detect deadlock") : expected DEADLOCK, unfinished P0,P1,P2.