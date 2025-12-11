#include <iostream>
#include <fstream>
#include <string>
#include <vector>
#include <nlohmann/json.hpp>

// Use the nlohmann namespace for convenience
using json = nlohmann::json;

int main() {
    // 1. Open the JSONL file
    std::string filename = "../logs/tesla_raw_log.jsonl";
    std::ifstream file(filename);

    if (!file.is_open()) {
        std::cerr << "Error: Could not open file " << filename << std::endl;
        return 1;
    }

    std::string line;
    int line_count = 0;

    std::cout << "Starting 'Dumb' Replay of Tesla Data..." << std::endl;

    // 2. Read line by line
    while (std::getline(file, line)) {
        try {
            // 3. Parse the JSON line
            auto data = json::parse(line);

            // 4. Extract Fields (safely)

            // Timestamp (from drive_state -> timestamp)
            int64_t timestamp = 0LL;
            if (data.contains("drive_state") && !data["drive_state"].is_null()) {
                timestamp = data["drive_state"].value("timestamp", 0LL);
            }

            // Speed (drive_state -> speed)
            // Speed can be null in the JSON if stopped, so we handle that
            float speed = 0.0f;
            if (data.contains("drive_state") && !data["drive_state"].is_null() && !data["drive_state"]["speed"].is_null()) {
                speed = data["drive_state"].value("speed", 0.0f);
            }

            // Battery (charge_state -> battery_level)
            int battery = 0;
            if (data.contains("charge_state") && !data["charge_state"].is_null()) {
                battery = data["charge_state"].value("battery_level", 0);
            }

            // Power (drive_state -> power)
            float power = 0.0f;
             if (data.contains("drive_state") && !data["drive_state"].is_null()) {
                power = data["drive_state"].value("power", 0.0f);
            }

            // Gear (drive_state -> shift_state) - can be null
            std::string gear = "P"; // Default to Park
            if (data.contains("drive_state") && !data["drive_state"].is_null() && !data["drive_state"]["shift_state"].is_null()) {
                gear = data["drive_state"].value("shift_state", "P");
            }

            // 5. Print to Console
            std::cout << "Line " << line_count++ << " | "
                      << "Time: " << timestamp << " | "
                      << "Speed: " << speed << " mph | "
                      << "Bat: " << battery << "% | "
                      << "Pwr: " << power << " kW | "
                      << "Gear: " << gear << " | "
                      << std::endl;

        } catch (json::parse_error& e) {
            std::cerr << "JSON Parse Error on line " << line_count << ": " << e.what() << std::endl;
        } catch (std::exception& e) {
            std::cerr << "General Error: " << e.what() << std::endl;
        }
    }

    std::cout << "Replay Finished." << std::endl;
    return 0;
}