-- Synthetic demonstration data (no real airline or passenger data). Run after schema.sql.
USE airport_runway_db;

INSERT INTO runways (name, length_m, status) VALUES ('09L/27R', 3800, 'ACTIVE'), ('09R/27L', 3200, 'ACTIVE'), ('14/32', 2400, 'MAINTENANCE');

INSERT INTO aircraft (registration, model, airline, status) VALUES
 ('VT-AAA','Airbus A320','Demo Air','ACTIVE'), ('VT-AAB','Boeing 737-800','Demo Air','ACTIVE'),
 ('VT-AAC','Airbus A321','Skyline Demo','ACTIVE'), ('VT-AAD','ATR 72','Regional Demo','ACTIVE'),
 ('VT-AAE','Boeing 787-8','Skyline Demo','IN_MAINTENANCE'), ('VT-AAF','Airbus A350','Demo Air','ACTIVE');

-- Runway module inputs: smaller priority number = more urgent (1 = emergency / medical)
INSERT INTO flights (flight_number, aircraft_id, runway_id, operation, arrival_time, burst_time, priority) VALUES
 ('DA101',1,1,'ARRIVAL',0,5,3), ('DA202',2,1,'DEPARTURE',1,3,2), ('SD303',3,1,'ARRIVAL',2,8,4),
 ('RD404',4,1,'ARRIVAL',3,2,1), ('DA505',6,1,'DEPARTURE',4,6,5), ('SD606',3,1,'DEPARTURE',20,4,2);

INSERT INTO baggage_batches (flight_id, bag_count, arrival_time, burst_time, priority) VALUES
 (1,120,0,8,3), (2,60,1,4,2), (3,200,2,9,4), (4,15,3,2,1), (5,150,5,7,5), (6,80,25,5,3);

INSERT INTO maintenance_tasks (aircraft_id, description, arrival_time, burst_time, priority) VALUES
 (5,'Engine borescope inspection',0,8,3), (1,'Cabin pressure sensor check',1,4,2), (2,'Brake wear measurement',2,6,4),
 (6,'Hydraulic leak repair (urgent)',3,3,1), (4,'Tyre replacement',4,5,3), (3,'Avionics software update',6,7,5);

-- Resource inventory = demo scenario 1 (classic Banker's example extended with a 4th resource type)
INSERT INTO resource_types (name, total_instances, allocated_instances) VALUES
 ('Maintenance Bays',10,7), ('Diagnostic Equipment',5,2), ('Baggage Sorting Stations',7,5), ('Ground-Support Equipment',3,1);
INSERT INTO processes (name, description) VALUES
 ('P0','Engine overhaul crew'), ('P1','Cabin inspection crew'), ('P2','Cargo transfer crew'), ('P3','Avionics crew'), ('P4','Baggage reroute crew');
INSERT INTO max_demands (process_id, resource_id, max_units) VALUES
 (1,1,7),(1,2,5),(1,3,3),(1,4,1), (2,1,3),(2,2,2),(2,3,2),(2,4,1), (3,1,9),(3,2,0),(3,3,2),(3,4,0),
 (4,1,2),(4,2,2),(4,3,2),(4,4,1), (5,1,4),(5,2,3),(5,3,3),(5,4,0);
INSERT INTO allocations (process_id, resource_id, units) VALUES
 (1,1,0),(1,2,1),(1,3,0),(1,4,0), (2,1,2),(2,2,0),(2,3,0),(2,4,1), (3,1,3),(3,2,0),(3,3,2),(3,4,0),
 (4,1,2),(4,2,1),(4,3,1),(4,4,0), (5,1,0),(5,2,0),(5,3,2),(5,4,0);
INSERT INTO outstanding_requests (process_id, resource_id, units)
 SELECT p.process_id, r.resource_id, 0 FROM processes p CROSS JOIN resource_types r;
