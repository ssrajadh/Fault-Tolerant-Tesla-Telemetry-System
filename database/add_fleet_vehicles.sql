-- Add Multi-Vehicle Fleet for Simulation

INSERT INTO vehicles (vin, model, year, owner_email) VALUES
('5YJ3E1EA2KF000002', 'Model Y Performance', 2024, 'fleet@example.com'),
('5YJSA1E26MF000003', 'Model S Plaid', 2024, 'fleet@example.com'),
('7SAYGDEE3MF000004', 'Model X Long Range', 2023, 'fleet@example.com'),
('5YJ3E1EB9MF000005', 'Model 3 Standard Range', 2024, 'fleet@example.com')
ON CONFLICT (vin) DO NOTHING;

-- Verify vehicles were added
SELECT id, vin, model, year FROM vehicles ORDER BY vin;
