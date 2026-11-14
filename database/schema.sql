-- Airport Runway Management System - MySQL 8.x schema
-- Usage: mysql -u <user> -p < database/schema.sql      (re-running DROPS and recreates all tables)
CREATE DATABASE IF NOT EXISTS airport_runway_db CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
USE airport_runway_db;

SET FOREIGN_KEY_CHECKS = 0;
DROP TABLE IF EXISTS resource_transactions, deadlock_checks, outstanding_requests, allocations, max_demands, processes,
    resource_types, scheduling_results, scheduling_runs, maintenance_tasks, baggage_batches, flights, aircraft, runways;
SET FOREIGN_KEY_CHECKS = 1;

-- ---------- Operational records ----------
CREATE TABLE runways (
    runway_id   INT AUTO_INCREMENT PRIMARY KEY,
    name        VARCHAR(20) NOT NULL UNIQUE,                 -- e.g. 09L/27R
    length_m    INT NOT NULL,
    status      ENUM('ACTIVE','CLOSED','MAINTENANCE') NOT NULL DEFAULT 'ACTIVE',
    CONSTRAINT chk_runway_len CHECK (length_m BETWEEN 500 AND 6000)
) ENGINE=InnoDB;

CREATE TABLE aircraft (
    aircraft_id  INT AUTO_INCREMENT PRIMARY KEY,
    registration VARCHAR(20) NOT NULL UNIQUE,
    model        VARCHAR(40) NOT NULL,
    airline      VARCHAR(60) NOT NULL,
    status       ENUM('ACTIVE','IN_MAINTENANCE','RETIRED') NOT NULL DEFAULT 'ACTIVE'
) ENGINE=InnoDB;

CREATE TABLE flights (
    flight_id     INT AUTO_INCREMENT PRIMARY KEY,
    flight_number VARCHAR(12) NOT NULL UNIQUE,
    aircraft_id   INT NOT NULL,
    runway_id     INT NULL,
    operation     ENUM('ARRIVAL','DEPARTURE') NOT NULL DEFAULT 'ARRIVAL',
    arrival_time  INT NOT NULL,                              -- simulated minutes
    burst_time    INT NOT NULL,                              -- runway occupancy, minutes
    priority      INT NOT NULL DEFAULT 5,                    -- 1 = most urgent
    CONSTRAINT fk_flight_aircraft FOREIGN KEY (aircraft_id) REFERENCES aircraft(aircraft_id) ON DELETE RESTRICT,
    CONSTRAINT fk_flight_runway   FOREIGN KEY (runway_id)   REFERENCES runways(runway_id)   ON DELETE SET NULL,
    CONSTRAINT chk_flight_times CHECK (arrival_time >= 0 AND burst_time >= 1 AND priority BETWEEN 1 AND 99),
    INDEX idx_flight_aircraft (aircraft_id)
) ENGINE=InnoDB;

CREATE TABLE baggage_batches (
    batch_id     INT AUTO_INCREMENT PRIMARY KEY,
    flight_id    INT NOT NULL,
    bag_count    INT NOT NULL DEFAULT 0,
    arrival_time INT NOT NULL,
    burst_time   INT NOT NULL,
    priority     INT NOT NULL DEFAULT 5,
    CONSTRAINT fk_batch_flight FOREIGN KEY (flight_id) REFERENCES flights(flight_id) ON DELETE CASCADE,
    CONSTRAINT chk_batch CHECK (arrival_time >= 0 AND burst_time >= 1 AND priority BETWEEN 1 AND 99 AND bag_count >= 0),
    INDEX idx_batch_flight (flight_id)
) ENGINE=InnoDB;

CREATE TABLE maintenance_tasks (
    task_id      INT AUTO_INCREMENT PRIMARY KEY,
    aircraft_id  INT NOT NULL,
    description  VARCHAR(120) NOT NULL,
    arrival_time INT NOT NULL,
    burst_time   INT NOT NULL,
    priority     INT NOT NULL DEFAULT 5,
    status       ENUM('PENDING','COMPLETED') NOT NULL DEFAULT 'PENDING',
    CONSTRAINT fk_task_aircraft FOREIGN KEY (aircraft_id) REFERENCES aircraft(aircraft_id) ON DELETE RESTRICT,
    CONSTRAINT chk_task CHECK (arrival_time >= 0 AND burst_time >= 1 AND priority BETWEEN 1 AND 99),
    INDEX idx_task_aircraft (aircraft_id), INDEX idx_task_status (status)
) ENGINE=InnoDB;

-- ---------- Scheduling history ----------
CREATE TABLE scheduling_runs (
    run_id         INT AUTO_INCREMENT PRIMARY KEY,
    module         ENUM('RUNWAY','BAGGAGE','MAINTENANCE') NOT NULL,
    algorithm      VARCHAR(20) NOT NULL,
    quantum        INT NULL,
    process_count  INT NOT NULL,
    avg_waiting    DECIMAL(10,2) NOT NULL,
    avg_turnaround DECIMAL(10,2) NOT NULL,
    avg_response   DECIMAL(10,2) NOT NULL,
    total_time     INT NOT NULL,
    gantt          JSON NOT NULL,
    created_at     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_run_module (module, created_at)
) ENGINE=InnoDB;

CREATE TABLE scheduling_results (
    result_id     INT AUTO_INCREMENT PRIMARY KEY,
    run_id        INT NOT NULL,
    process_label VARCHAR(60) NOT NULL,
    arrival_time  INT NOT NULL,
    burst_time    INT NOT NULL,
    priority      INT NOT NULL,
    start_time    INT NOT NULL,
    completion    INT NOT NULL,
    turnaround    INT NOT NULL,
    waiting       INT NOT NULL,
    response      INT NOT NULL,
    CONSTRAINT fk_result_run FOREIGN KEY (run_id) REFERENCES scheduling_runs(run_id) ON DELETE CASCADE,
    INDEX idx_result_run (run_id)
) ENGINE=InnoDB;

-- ---------- Resource allocation / deadlock management ----------
CREATE TABLE resource_types (
    resource_id         INT AUTO_INCREMENT PRIMARY KEY,
    name                VARCHAR(60) NOT NULL UNIQUE,
    total_instances     INT NOT NULL,
    allocated_instances INT NOT NULL DEFAULT 0,
    available_instances INT GENERATED ALWAYS AS (total_instances - allocated_instances) STORED,  -- invariant enforced by MySQL
    status              ENUM('ONLINE','OFFLINE') NOT NULL DEFAULT 'ONLINE',
    CONSTRAINT chk_res CHECK (total_instances >= 0 AND allocated_instances >= 0 AND allocated_instances <= total_instances)
) ENGINE=InnoDB;

CREATE TABLE processes (
    process_id  INT AUTO_INCREMENT PRIMARY KEY,
    name        VARCHAR(30) NOT NULL UNIQUE,
    description VARCHAR(120) NOT NULL DEFAULT '',
    status      ENUM('ACTIVE','TERMINATED') NOT NULL DEFAULT 'ACTIVE'
) ENGINE=InnoDB;

CREATE TABLE max_demands (
    process_id  INT NOT NULL,
    resource_id INT NOT NULL,
    max_units   INT NOT NULL DEFAULT 0,
    PRIMARY KEY (process_id, resource_id),
    CONSTRAINT fk_max_p FOREIGN KEY (process_id)  REFERENCES processes(process_id)      ON DELETE CASCADE,
    CONSTRAINT fk_max_r FOREIGN KEY (resource_id) REFERENCES resource_types(resource_id) ON DELETE CASCADE,
    CONSTRAINT chk_max CHECK (max_units >= 0)
) ENGINE=InnoDB;

CREATE TABLE allocations (
    process_id  INT NOT NULL,
    resource_id INT NOT NULL,
    units       INT NOT NULL DEFAULT 0,
    PRIMARY KEY (process_id, resource_id),
    CONSTRAINT fk_alloc_p FOREIGN KEY (process_id)  REFERENCES processes(process_id)      ON DELETE CASCADE,
    CONSTRAINT fk_alloc_r FOREIGN KEY (resource_id) REFERENCES resource_types(resource_id) ON DELETE CASCADE,
    CONSTRAINT chk_alloc CHECK (units >= 0)
) ENGINE=InnoDB;

CREATE TABLE outstanding_requests (   -- requests that are blocked/waiting; input to deadlock detection
    process_id  INT NOT NULL,
    resource_id INT NOT NULL,
    units       INT NOT NULL DEFAULT 0,
    PRIMARY KEY (process_id, resource_id),
    CONSTRAINT fk_req_p FOREIGN KEY (process_id)  REFERENCES processes(process_id)      ON DELETE CASCADE,
    CONSTRAINT fk_req_r FOREIGN KEY (resource_id) REFERENCES resource_types(resource_id) ON DELETE CASCADE,
    CONSTRAINT chk_req CHECK (units >= 0)
) ENGINE=InnoDB;

CREATE TABLE deadlock_checks (
    check_id    INT AUTO_INCREMENT PRIMARY KEY,
    result      ENUM('NO_DEADLOCK','DEADLOCK','INVALID_STATE','INSUFFICIENT_INFORMATION') NOT NULL,
    finishable  JSON NOT NULL,
    unfinished  JSON NOT NULL,
    explanation VARCHAR(255) NOT NULL,
    created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_check_result (result)
) ENGINE=InnoDB;

CREATE TABLE resource_transactions (  -- audit log; kept even if the process row is deleted
    txn_id       INT AUTO_INCREMENT PRIMARY KEY,
    process_id   INT NULL,
    process_name VARCHAR(30) NOT NULL DEFAULT '-',
    txn_type     ENUM('REQUEST','RELEASE','TERMINATE','DEMO_INIT') NOT NULL,
    decision     VARCHAR(30) NOT NULL,
    quantities   JSON NOT NULL,
    message      VARCHAR(255) NOT NULL,
    created_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_txn_p FOREIGN KEY (process_id) REFERENCES processes(process_id) ON DELETE SET NULL,
    INDEX idx_txn_type (txn_type, decision)
) ENGINE=InnoDB;
