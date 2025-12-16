#include <iostream>
#include <fstream>
#include <string>
#include <vector>
#include <thread>
#include <atomic>
#include <chrono>
#include <curl/curl.h>
#include <nlohmann/json.hpp>
#include <sqlite3.h>
#include "telemetry.pb.h"

using json = nlohmann::json;

// Server configuration
const char* SERVER_URL = "http://localhost:8000/telemetry";

// Callback for curl to handle response (we ignore it)
size_t write_callback(void* contents, size_t size, size_t nmemb, void* userp) {
    return size * nmemb;
}

// Global flag for online/offline status
std::atomic<bool> is_online(true);

// Thread to listen for Enter key to toggle online/offline
void connectionToggleThread() {
    std::string input;
    while (true) {
        std::getline(std::cin, input);
        is_online = !is_online;
        std::cout << "\n[CONNECTION] Toggled to: " << (is_online ? "ONLINE" : "OFFLINE") << std::endl;
    }
}

// Initialize SQLite database
sqlite3* initDatabase() {
    sqlite3* db;
    int rc = sqlite3_open("telemetry_buffer.db", &db);
    
    if (rc) {
        std::cerr << "Can't open database: " << sqlite3_errmsg(db) << std::endl;
        return nullptr;
    }
    
    // Create table if it doesn't exist
    const char* sql = 
        "CREATE TABLE IF NOT EXISTS telemetry_buffer ("
        "id INTEGER PRIMARY KEY AUTOINCREMENT,"
        "timestamp INTEGER,"
        "protobuf_data BLOB"
        ");";
    
    char* errMsg = nullptr;
    rc = sqlite3_exec(db, sql, nullptr, nullptr, &errMsg);
    
    if (rc != SQLITE_OK) {
        std::cerr << "SQL error: " << errMsg << std::endl;
        sqlite3_free(errMsg);
        sqlite3_close(db);
        return nullptr;
    }
    
    std::cout << "[DATABASE] Initialized telemetry_buffer.db" << std::endl;
    return db;
}

// Store protobuf data to SQLite
bool storeToBuffer(sqlite3* db, int64_t timestamp, const std::string& protobuf_data) {
    const char* sql = "INSERT INTO telemetry_buffer (timestamp, protobuf_data) VALUES (?, ?);";
    sqlite3_stmt* stmt;
    
    int rc = sqlite3_prepare_v2(db, sql, -1, &stmt, nullptr);
    if (rc != SQLITE_OK) {
        std::cerr << "[BUFFER ERROR] Failed to prepare statement" << std::endl;
        return false;
    }
    
    sqlite3_bind_int64(stmt, 1, timestamp);
    sqlite3_bind_blob(stmt, 2, protobuf_data.data(), protobuf_data.size(), SQLITE_TRANSIENT);
    
    rc = sqlite3_step(stmt);
    sqlite3_finalize(stmt);
    
    if (rc != SQLITE_DONE) {
        std::cerr << "[BUFFER ERROR] Failed to insert data" << std::endl;
        return false;
    }
    
    return true;
}

// Upload data to server via HTTP POST
bool uploadToServer(const std::string& serialized_data, const tesla::VehicleData& data) {
    CURL* curl = curl_easy_init();
    if (!curl) {
        std::cerr << "[UPLOAD ERROR] Failed to initialize curl" << std::endl;
        return false;
    }
    
    struct curl_slist* headers = nullptr;
    headers = curl_slist_append(headers, "Content-Type: application/octet-stream");
    
    curl_easy_setopt(curl, CURLOPT_URL, SERVER_URL);
    curl_easy_setopt(curl, CURLOPT_POST, 1L);
    curl_easy_setopt(curl, CURLOPT_POSTFIELDS, serialized_data.c_str());
    curl_easy_setopt(curl, CURLOPT_POSTFIELDSIZE, serialized_data.size());
    curl_easy_setopt(curl, CURLOPT_HTTPHEADER, headers);
    curl_easy_setopt(curl, CURLOPT_WRITEFUNCTION, write_callback);
    curl_easy_setopt(curl, CURLOPT_TIMEOUT, 5L);
    
    CURLcode res = curl_easy_perform(curl);
    
    bool success = (res == CURLE_OK);
    if (success) {
        std::cout << "[UPLOAD] ✓ Sent to server: "
                  << "Time=" << data.timestamp() 
                  << ", Speed=" << data.vehicle_speed() << " mph"
                  << ", Battery=" << data.battery_level() << "%"
                  << ", Power=" << data.power_kw() << " kW"
                  << ", Gear=" << data.gear()
                  << ", Odometer=" << data.odometer() << " mi"
                  << ", Heading=" << data.heading() << "°"
                  << std::endl;
    } else {
        std::cerr << "[UPLOAD ERROR] Failed: " << curl_easy_strerror(res) << std::endl;
    }
    
    curl_slist_free_all(headers);
    curl_easy_cleanup(curl);
    
    return success;
}

// Flush buffered data when back online
void flushBuffer(sqlite3* db) {
    const char* sql = "SELECT id, timestamp, protobuf_data FROM telemetry_buffer ORDER BY timestamp;";
    sqlite3_stmt* stmt;
    
    int rc = sqlite3_prepare_v2(db, sql, -1, &stmt, nullptr);
    if (rc != SQLITE_OK) {
        std::cerr << "[FLUSH ERROR] Failed to prepare select" << std::endl;
        return;
    }
    
    int count = 0;
    int failed = 0;
    while (sqlite3_step(stmt) == SQLITE_ROW) {
        int id = sqlite3_column_int(stmt, 0);
        const void* blob = sqlite3_column_blob(stmt, 2);
        int blob_size = sqlite3_column_bytes(stmt, 2);
        
        // Deserialize protobuf
        tesla::VehicleData data;
        if (data.ParseFromArray(blob, blob_size)) {
            std::string serialized_data((const char*)blob, blob_size);
            
            // Try to upload
            if (uploadToServer(serialized_data, data)) {
                // Delete from buffer after successful upload
                std::string delete_sql = "DELETE FROM telemetry_buffer WHERE id = " + std::to_string(id) + ";";
                sqlite3_exec(db, delete_sql.c_str(), nullptr, nullptr, nullptr);
                count++;
            } else {
                failed++;
                // Keep in buffer if upload fails
            }
        }
    }
    
    sqlite3_finalize(stmt);
    
    if (count > 0) {
        std::cout << "[FLUSH] Successfully uploaded " << count << " buffered records";
        if (failed > 0) {
            std::cout << " (" << failed << " failed, kept in buffer)";
        }
        std::cout << std::endl;
    }
}

int main() {
    // Initialize curl globally
    curl_global_init(CURL_GLOBAL_DEFAULT);
    
    // Verify that the version of the library that we linked against is
    // compatible with the version of the headers we compiled against.
    GOOGLE_PROTOBUF_VERIFY_VERSION;
    
    // Initialize SQLite database
    sqlite3* db = initDatabase();
    if (!db) {
        return 1;
    }
    
    // Start connection toggle thread
    std::thread toggleThread(connectionToggleThread);
    toggleThread.detach();
    
    std::cout << "\n=== Store-and-Forward Tesla Telemetry System ===" << std::endl;
    std::cout << "Press ENTER to toggle ONLINE/OFFLINE mode" << std::endl;
    std::cout << "Current Status: " << (is_online ? "ONLINE" : "OFFLINE") << "\n" << std::endl;
    
    // Open JSONL file (simulating CAN bus)
    std::string filename = "../logs/tesla_raw_log.jsonl";
    std::ifstream file(filename);
    
    if (!file.is_open()) {
        std::cerr << "Error: Could not open file " << filename << std::endl;
        sqlite3_close(db);
        return 1;
    }
    
    std::string line;
    int line_count = 0;
    bool was_offline = false;
    
    // Process each line
    while (std::getline(file, line)) {
        try {
            // Parse JSON (simulating CAN bus data)
            auto json_data = json::parse(line);
            
            // Extract fields safely
            int64_t timestamp = 0LL;
            if (json_data.contains("drive_state") && !json_data["drive_state"].is_null()) {
                timestamp = json_data["drive_state"].value("timestamp", 0LL);
            }
            
            float speed = 0.0f;
            if (json_data.contains("drive_state") && !json_data["drive_state"].is_null() 
                && !json_data["drive_state"]["speed"].is_null()) {
                speed = json_data["drive_state"].value("speed", 0.0f);
            }
            
            int battery = 0;
            if (json_data.contains("charge_state") && !json_data["charge_state"].is_null()) {
                battery = json_data["charge_state"].value("battery_level", 0);
            }
            
            float power = 0.0f;
            if (json_data.contains("drive_state") && !json_data["drive_state"].is_null()) {
                power = json_data["drive_state"].value("power", 0.0f);
            }
            
            std::string gear = "P";
            if (json_data.contains("drive_state") && !json_data["drive_state"].is_null() 
                && !json_data["drive_state"]["shift_state"].is_null()) {
                gear = json_data["drive_state"].value("shift_state", "P");
            }
            
            float odometer = 0.0f;
            if (json_data.contains("vehicle_state") && !json_data["vehicle_state"].is_null() 
                && json_data["vehicle_state"].contains("odometer") 
                && !json_data["vehicle_state"]["odometer"].is_null()) {
                odometer = json_data["vehicle_state"]["odometer"].get<float>();
            }
            
            int heading = 0;
            if (json_data.contains("drive_state") && !json_data["drive_state"].is_null() 
                && json_data["drive_state"].contains("heading") 
                && !json_data["drive_state"]["heading"].is_null()) {
                heading = json_data["drive_state"]["heading"].get<int>();
            }
            
            // Create Protobuf message
            tesla::VehicleData vehicle_data;
            vehicle_data.set_timestamp(timestamp);
            vehicle_data.set_vehicle_speed(speed);
            vehicle_data.set_battery_level(battery);
            vehicle_data.set_power_kw(power);
            vehicle_data.set_gear(gear);
            vehicle_data.set_odometer(odometer);
            vehicle_data.set_heading(heading);
            
            // Serialize to binary
            std::string serialized_data;
            vehicle_data.SerializeToString(&serialized_data);
            
            // Check online status
            if (is_online) {
                // If we just came back online, flush buffer first
                if (was_offline) {
                    std::cout << "\n[RECONNECTED] Flushing buffered data..." << std::endl;
                    flushBuffer(db);
                    was_offline = false;
                }
                
                // Upload directly
                if (!uploadToServer(serialized_data, vehicle_data)) {
                    // If upload fails, buffer it
                    std::cout << "[FALLBACK] Upload failed, buffering..." << std::endl;
                    storeToBuffer(db, timestamp, serialized_data);
                }
            } else {
                // Store to buffer
                if (storeToBuffer(db, timestamp, serialized_data)) {
                    std::cout << "[BUFFERED] Record " << line_count 
                              << " stored to SQLite (Time=" << timestamp << ")" << std::endl;
                }
                was_offline = true;
            }
            
            line_count++;
            
            // Small delay to simulate real-time processing
            std::this_thread::sleep_for(std::chrono::milliseconds(100));
            
        } catch (json::parse_error& e) {
            std::cerr << "JSON Parse Error: " << e.what() << std::endl;
        } catch (std::exception& e) {
            std::cerr << "Error: " << e.what() << std::endl;
        }
    }
    
    // Final flush if we end online
    if (is_online && was_offline) {
        std::cout << "\n[FINAL FLUSH] Uploading remaining buffered data..." << std::endl;
        flushBuffer(db);
    }
    
    std::cout << "\nReplay Finished. Processed " << line_count << " records." << std::endl;
    
    // Cleanup
    sqlite3_close(db);
    file.close();
    google::protobuf::ShutdownProtobufLibrary();
    curl_global_cleanup();
    
    return 0;
}