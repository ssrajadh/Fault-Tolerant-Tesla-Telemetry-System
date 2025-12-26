#include <iostream>
#include <fstream>
#include <string>
#include <vector>
#include <thread>
#include <atomic>
#include <chrono>
#include <cmath>
#include <curl/curl.h>
#include <nlohmann/json.hpp>
#include <sqlite3.h>
#include "telemetry.pb.h"

using json = nlohmann::json;

// ============================================================================
// Predictive Compression Engine
// ============================================================================

struct PredictorConfig {
    float alpha = 0.3f;              // Smoothing factor
    float speed_threshold = 2.0f;     // mph
    float power_threshold = 5.0f;     // kW
    float battery_threshold = 0.5f;   // %
    float heading_threshold = 5.0f;   // degrees
    int resync_interval = 30;         // seconds
};

struct TransmitDecisions {
    bool speed;
    bool power;
    bool battery;
    bool heading;
    bool is_resync;
};

class TelemetryPredictor {
private:
    PredictorConfig config;
    
    // Predicted values
    float predicted_speed;
    float predicted_power;
    float predicted_battery;
    float predicted_heading;
    
    // Flags for first reading
    bool has_speed;
    bool has_power;
    bool has_battery;
    bool has_heading;
    
    // Resync tracking
    std::chrono::time_point<std::chrono::steady_clock> last_resync_time;
    
    // Statistics
    int total_readings;
    int transmitted_readings;
    int skipped_readings;
    
    float exponentialSmooth(float actual, float last_predicted) {
        return config.alpha * actual + (1.0f - config.alpha) * last_predicted;
    }
    
    bool shouldTransmit(float actual, float predicted, float threshold, bool has_prediction) {
        if (!has_prediction) return true;  // Always send first reading
        return std::abs(actual - predicted) > threshold;
    }
    
public:
    TelemetryPredictor() 
        : predicted_speed(0), predicted_power(0), predicted_battery(0), predicted_heading(0),
          has_speed(false), has_power(false), has_battery(false), has_heading(false),
          total_readings(0), transmitted_readings(0), skipped_readings(0) {
        last_resync_time = std::chrono::steady_clock::now();
    }
    
    TransmitDecisions shouldTransmitPacket(float speed, float power, float battery, float heading) {
        total_readings++;
        auto current_time = std::chrono::steady_clock::now();
        auto elapsed = std::chrono::duration_cast<std::chrono::seconds>(current_time - last_resync_time);
        
        TransmitDecisions decisions;
        
        // Check if we need to resync
        if (elapsed.count() >= config.resync_interval) {
            decisions.speed = true;
            decisions.power = true;
            decisions.battery = true;
            decisions.heading = true;
            decisions.is_resync = true;
            last_resync_time = current_time;
        } else {
            decisions.speed = shouldTransmit(speed, predicted_speed, config.speed_threshold, has_speed);
            decisions.power = shouldTransmit(power, predicted_power, config.power_threshold, has_power);
            decisions.battery = shouldTransmit(battery, predicted_battery, config.battery_threshold, has_battery);
            decisions.heading = shouldTransmit(heading, predicted_heading, config.heading_threshold, has_heading);
            decisions.is_resync = false;
        }
        
        // Update statistics
        if (decisions.speed || decisions.power || decisions.battery || decisions.heading) {
            transmitted_readings++;
        } else {
            skipped_readings++;
        }
        
        // Update predictions
        predicted_speed = exponentialSmooth(speed, has_speed ? predicted_speed : speed);
        predicted_power = exponentialSmooth(power, has_power ? predicted_power : power);
        predicted_battery = exponentialSmooth(battery, has_battery ? predicted_battery : battery);
        predicted_heading = exponentialSmooth(heading, has_heading ? predicted_heading : heading);
        
        has_speed = has_power = has_battery = has_heading = true;
        
        return decisions;
    }
    
    void printStats() {
        if (total_readings > 0) {
            float compression_ratio = (float)skipped_readings / total_readings * 100.0f;
            std::cout << "[COMPRESSION] Transmitted: " << transmitted_readings 
                      << "/" << total_readings 
                      << " | Bandwidth saved: " << compression_ratio << "%" << std::endl;
        }
    }
    
    void reset() {
        has_speed = has_power = has_battery = has_heading = false;
        total_readings = transmitted_readings = skipped_readings = 0;
        last_resync_time = std::chrono::steady_clock::now();
    }
};

// Global predictor instance
TelemetryPredictor g_predictor;

// ============================================================================
// Server and Database Functions
// ============================================================================

// Server configuration - use environment variable if set, otherwise default to 8001
std::string getServerUrl() {
    const char* port_env = std::getenv("SERVER_PORT");
    std::string port = port_env ? port_env : "8001";
    return "http://localhost:" + port + "/telemetry";
}

const std::string SERVER_URL = getServerUrl();

// Callback for curl to handle response (we ignore it)
size_t write_callback(void* contents, size_t size, size_t nmemb, void* userp) {
    return size * nmemb;
}

// Global flag for online/offline status
std::atomic<bool> is_online(true);

// Global vehicle VIN (configurable via environment variable)
std::string g_vehicle_vin = "5YJ3E1EA1KF000001";  // Default VIN

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
    // Use vehicle-specific database file
    std::string db_filename = "telemetry_buffer_" + g_vehicle_vin + ".db";
    sqlite3* db;
    int rc = sqlite3_open(db_filename.c_str(), &db);
    
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
    
    std::cout << "[DATABASE] Initialized " << db_filename << std::endl;
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
    
    curl_easy_setopt(curl, CURLOPT_URL, SERVER_URL.c_str());
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

// Upload compressed data to server via HTTP POST
bool uploadCompressedToServer(const std::string& serialized_data, const tesla::CompressedVehicleData& data) {
    CURL* curl = curl_easy_init();
    if (!curl) {
        std::cerr << "[UPLOAD ERROR] Failed to initialize curl" << std::endl;
        return false;
    }
    
    struct curl_slist* headers = nullptr;
    headers = curl_slist_append(headers, "Content-Type: application/octet-stream");
    headers = curl_slist_append(headers, "X-Compressed: true");  // Signal compressed data
    
    // Add VIN header for multi-vehicle support
    std::string vin_header = "X-Vehicle-VIN: " + g_vehicle_vin;
    headers = curl_slist_append(headers, vin_header.c_str());
    
    curl_easy_setopt(curl, CURLOPT_URL, SERVER_URL.c_str());
    curl_easy_setopt(curl, CURLOPT_POST, 1L);
    curl_easy_setopt(curl, CURLOPT_POSTFIELDS, serialized_data.c_str());
    curl_easy_setopt(curl, CURLOPT_POSTFIELDSIZE, serialized_data.size());
    curl_easy_setopt(curl, CURLOPT_HTTPHEADER, headers);
    curl_easy_setopt(curl, CURLOPT_WRITEFUNCTION, write_callback);
    curl_easy_setopt(curl, CURLOPT_TIMEOUT, 5L);
    
    CURLcode res = curl_easy_perform(curl);
    
    bool success = (res == CURLE_OK);
    if (success) {
        std::cout << "[UPLOAD COMPRESSED] ✓ Sent: VIN=" << g_vehicle_vin.substr(g_vehicle_vin.length() - 6)
                  << " Time=" << data.timestamp()
                  << ", Odometer=" << data.odometer() << " mi"
                  << (data.has_vehicle_speed() ? " +Speed" : "")
                  << (data.has_battery_level() ? " +Battery" : "")
                  << (data.has_power_kw() ? " +Power" : "")
                  << (data.has_heading() ? " +Heading" : "")
                  << (data.is_resync() ? " [RESYNC]" : "")
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
        
        // Deserialize compressed protobuf
        tesla::CompressedVehicleData data;
        if (data.ParseFromArray(blob, blob_size)) {
            std::string serialized_data((const char*)blob, blob_size);
            
            // Try to upload compressed data
            if (uploadCompressedToServer(serialized_data, data)) {
                // Delete from buffer after successful upload
                std::string delete_sql = "DELETE FROM telemetry_buffer WHERE id = " + std::to_string(id) + ";";
                sqlite3_exec(db, delete_sql.c_str(), nullptr, nullptr, nullptr);
                count++;
                
                // Small delay between uploads to prevent frontend calculation issues
                // This simulates real-time data arrival for efficiency calculations
                std::this_thread::sleep_for(std::chrono::milliseconds(100));
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

int main(int argc, char* argv[]) {
    // Initialize curl globally
    curl_global_init(CURL_GLOBAL_DEFAULT);
    
    // Verify that the version of the library that we linked against is
    // compatible with the version of the headers we compiled against.
    GOOGLE_PROTOBUF_VERIFY_VERSION;
    
    // Read vehicle VIN from environment variable or command line argument
    const char* vin_env = std::getenv("VEHICLE_VIN");
    if (argc > 1) {
        g_vehicle_vin = argv[1];  // Command line argument takes priority
    } else if (vin_env) {
        g_vehicle_vin = vin_env;
    }
    // else use default VIN
    
    std::cout << "\n=== Multi-Vehicle Tesla Telemetry System ===" << std::endl;
    std::cout << "Vehicle VIN: " << g_vehicle_vin << std::endl;
    
    // Initialize SQLite database (vehicle-specific)
    sqlite3* db = initDatabase();
    if (!db) {
        return 1;
    }
    
    // Start connection toggle thread
    std::thread toggleThread(connectionToggleThread);
    toggleThread.detach();
    
    std::cout << "Press ENTER to toggle ONLINE/OFFLINE mode" << std::endl;
    std::cout << "Current Status: " << (is_online ? "ONLINE" : "OFFLINE") << "\n" << std::endl;
    
    // Open JSONL file (simulating CAN bus)
    // Check multiple possible paths (local dev vs Docker container)
    // For multi-vehicle simulation, look for vehicle-specific files first
    std::vector<std::string> possible_paths = {
        "../data/vehicle_logs/tesla_log_" + g_vehicle_vin + ".jsonl",  // Vehicle-specific log
        "../data/tesla_raw_log.jsonl",   // Local development (full file)
        "/app/data/tesla_raw_log.jsonl",  // Docker container (full file)
        "../data/tesla_sample.jsonl",    // Local development (sample)
        "/app/data/tesla_sample.jsonl",  // Docker container (sample)
        "../logs/tesla_raw_log.jsonl",   // Legacy path
        "data/tesla_raw_log.jsonl"       // Current directory relative
    };
    
    std::string filename;
    std::ifstream file;
    for (const auto& path : possible_paths) {
        file.open(path);
        if (file.is_open()) {
            filename = path;
            std::cout << "Loaded telemetry data from: " << path << std::endl;
            break;
        }
    }
    
    if (!file.is_open()) {
        std::cerr << "Error: Could not open Tesla log file in any of these locations:" << std::endl;
        for (const auto& path : possible_paths) {
            std::cerr << "  - " << path << std::endl;
        }
        std::cerr << "\nNote: For production deployment, create a sample file with:" << std::endl;
        std::cerr << "  head -100 data/tesla_raw_log.jsonl > data/tesla_sample.jsonl" << std::endl;
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
            
            // ============================================================
            // PREDICTIVE COMPRESSION: Decide what to transmit
            // ============================================================
            TransmitDecisions decisions = g_predictor.shouldTransmitPacket(
                speed, power, static_cast<float>(battery), static_cast<float>(heading)
            );
            
            // Create compressed Protobuf message
            tesla::CompressedVehicleData compressed_data;
            compressed_data.set_timestamp(timestamp);
            compressed_data.set_odometer(odometer);  // Always send odometer (critical)
            compressed_data.set_is_resync(decisions.is_resync);
            
            // Only set fields that need transmission
            if (decisions.speed) compressed_data.set_vehicle_speed(speed);
            if (decisions.power) compressed_data.set_power_kw(power);
            if (decisions.battery) compressed_data.set_battery_level(battery);
            if (decisions.heading) compressed_data.set_heading(heading);
            
            // Serialize compressed data
            std::string serialized_compressed;
            compressed_data.SerializeToString(&serialized_compressed);
            
            // Check online status
            if (is_online) {
                // If we just came back online, flush buffer first
                if (was_offline) {
                    std::cout << "\n[RECONNECTED] Flushing buffered data..." << std::endl;
                    flushBuffer(db);
                    g_predictor.printStats();
                    // DON'T reset predictor - keep it synchronized with server!
                    was_offline = false;
                }
                
                // Upload compressed data
                if (!uploadCompressedToServer(serialized_compressed, compressed_data)) {
                    // If upload fails, buffer it
                    std::cout << "[FALLBACK] Upload failed, buffering..." << std::endl;
                    storeToBuffer(db, timestamp, serialized_compressed);
                }
            } else {
                // For offline buffering, store COMPLETE data (all fields)
                // This ensures proper reconstruction when flushed later
                tesla::CompressedVehicleData complete_data;
                complete_data.set_timestamp(timestamp);
                complete_data.set_odometer(odometer);
                complete_data.set_vehicle_speed(speed);
                complete_data.set_power_kw(power);
                complete_data.set_battery_level(battery);
                complete_data.set_heading(heading);
                complete_data.set_is_resync(true);  // Mark as resync for server
                
                std::string serialized_complete;
                complete_data.SerializeToString(&serialized_complete);
                
                // Store complete data to buffer
                if (storeToBuffer(db, timestamp, serialized_complete)) {
                    std::cout << "[BUFFERED] Record " << line_count 
                              << " stored to SQLite (Time=" << timestamp << ")" << std::endl;
                }
                was_offline = true;
            }
            
            line_count++;
            
            // Print compression stats every 50 records
            if (line_count % 50 == 0) {
                g_predictor.printStats();
            }
            
            // Small delay to simulate real-time processing
            std::this_thread::sleep_for(std::chrono::milliseconds(300));
            
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
    g_predictor.printStats();  // Print final compression statistics
    
    // Cleanup
    sqlite3_close(db);
    file.close();
    google::protobuf::ShutdownProtobufLibrary();
    curl_global_cleanup();
    
    return 0;
}