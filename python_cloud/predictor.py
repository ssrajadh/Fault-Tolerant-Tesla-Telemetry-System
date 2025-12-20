"""
Telemetry Predictor - Server-side reconstruction for compressed data
Mirrors the C++ predictor logic to maintain synchronization
"""

from dataclasses import dataclass
from typing import Optional, Dict
import time


@dataclass
class PredictorConfig:
    """Configuration matching C++ predictor settings"""
    alpha: float = 0.3  # Smoothing factor
    speed_threshold: float = 2.0  # mph
    power_threshold: float = 5.0  # kW
    battery_threshold: float = 0.5  # %
    heading_threshold: float = 5.0  # degrees
    resync_interval: int = 30  # seconds


class TelemetryPredictor:
    """
    Server-side predictor that mirrors the C++ edge predictor.
    Used to reconstruct missing fields in compressed telemetry.
    """
    
    def __init__(self, config: Optional[PredictorConfig] = None):
        self.config = config or PredictorConfig()
        
        # Predicted values
        self.predicted_speed = 0.0
        self.predicted_power = 0.0
        self.predicted_battery = 0.0
        self.predicted_heading = 0.0
        
        # State flags
        self.has_speed = False
        self.has_power = False
        self.has_battery = False
        self.has_heading = False
        
        # Statistics
        self.total_readings = 0
        self.transmitted_readings = 0
        self.skipped_readings = 0
        
        # Resync tracking
        self.last_resync_time = time.time()
    
    def _exponential_smooth(self, actual: float, last_predicted: float) -> float:
        """Apply exponential smoothing algorithm"""
        return self.config.alpha * actual + (1.0 - self.config.alpha) * last_predicted
    
    def _should_transmit(self, actual: float, predicted: float, threshold: float, has_prediction: bool) -> bool:
        """Determine if a value should be transmitted"""
        if not has_prediction:
            return True  # Always send first reading
        return abs(actual - predicted) > threshold
    
    def should_transmit_packet(self, speed: float, power: float, battery: float, heading: float) -> Dict[str, bool]:
        """
        Determine which fields should be transmitted.
        Returns dict with transmission decisions for each field.
        """
        self.total_readings += 1
        current_time = time.time()
        elapsed = current_time - self.last_resync_time
        
        # Check if resync is needed
        if elapsed >= self.config.resync_interval:
            decisions = {
                'speed': True,
                'power': True,
                'battery': True,
                'heading': True,
                'is_resync': True
            }
            self.last_resync_time = current_time
        else:
            decisions = {
                'speed': self._should_transmit(speed, self.predicted_speed, self.config.speed_threshold, self.has_speed),
                'power': self._should_transmit(power, self.predicted_power, self.config.power_threshold, self.has_power),
                'battery': self._should_transmit(battery, self.predicted_battery, self.config.battery_threshold, self.has_battery),
                'heading': self._should_transmit(heading, self.predicted_heading, self.config.heading_threshold, self.has_heading),
                'is_resync': False
            }
        
        # Update statistics
        if any([decisions['speed'], decisions['power'], decisions['battery'], decisions['heading']]):
            self.transmitted_readings += 1
        else:
            self.skipped_readings += 1
        
        # Update predictions using exponential smoothing
        self.predicted_speed = self._exponential_smooth(speed, self.predicted_speed if self.has_speed else speed)
        self.predicted_power = self._exponential_smooth(power, self.predicted_power if self.has_power else power)
        self.predicted_battery = self._exponential_smooth(battery, self.predicted_battery if self.has_battery else battery)
        self.predicted_heading = self._exponential_smooth(heading, self.predicted_heading if self.has_heading else heading)
        
        # Mark that we have predictions now
        self.has_speed = self.has_power = self.has_battery = self.has_heading = True
        
        return decisions
    
    def update_with_actual(self, speed: Optional[float] = None, power: Optional[float] = None, 
                          battery: Optional[float] = None, heading: Optional[float] = None):
        """
        Update predictor with actual values received from client.
        Only updates fields that were transmitted (not None).
        """
        if speed is not None:
            self.predicted_speed = self._exponential_smooth(speed, self.predicted_speed if self.has_speed else speed)
            self.has_speed = True
        
        if power is not None:
            self.predicted_power = self._exponential_smooth(power, self.predicted_power if self.has_power else power)
            self.has_power = True
        
        if battery is not None:
            self.predicted_battery = self._exponential_smooth(battery, self.predicted_battery if self.has_battery else battery)
            self.has_battery = True
        
        if heading is not None:
            self.predicted_heading = self._exponential_smooth(heading, self.predicted_heading if self.has_heading else heading)
            self.has_heading = True
    
    def get_predicted_values(self) -> Dict[str, float]:
        """Get current predicted values for reconstruction"""
        return {
            'speed': self.predicted_speed,
            'power': self.predicted_power,
            'battery': self.predicted_battery,
            'heading': self.predicted_heading
        }
    
    def get_compression_stats(self) -> Dict[str, any]:
        """Get compression statistics"""
        if self.total_readings == 0:
            return {
                'total_readings': 0,
                'transmitted_readings': 0,
                'compression_ratio': 0.0
            }
        
        compression_ratio = (self.skipped_readings / self.total_readings) * 100.0
        
        return {
            'total_readings': self.total_readings,
            'transmitted_readings': self.transmitted_readings,
            'skipped_readings': self.skipped_readings,
            'compression_ratio': round(compression_ratio, 2)
        }
    
    def reset(self):
        """Reset predictor state"""
        self.has_speed = False
        self.has_power = False
        self.has_battery = False
        self.has_heading = False
        self.total_readings = 0
        self.transmitted_readings = 0
        self.skipped_readings = 0
        self.last_resync_time = time.time()


# Test scenarios
if __name__ == "__main__":
    print("Testing Telemetry Predictor\n")
    print("=" * 60)
    
    predictor = TelemetryPredictor()
    
    # Scenario 1: Highway driving (steady state - high compression)
    print("\n🛣️  SCENARIO 1: Highway Driving (Steady State)")
    print("-" * 60)
    highway_data = [
        (65, 15, 80, 180),
        (65, 15, 80, 180),
        (66, 15, 79.9, 180),
        (66, 16, 79.8, 180),
        (65, 15, 79.7, 180),
    ]
    
    for i, (speed, power, battery, heading) in enumerate(highway_data, 1):
        decisions = predictor.should_transmit_packet(speed, power, battery, heading)
        fields = [k for k, v in decisions.items() if v and k != 'is_resync']
        print(f"Reading {i}: Speed={speed}, Power={power}, Battery={battery}, Heading={heading}")
        print(f"  → Transmit: {', '.join(fields) if fields else 'NOTHING (Skip transmission)'}")
    
    stats = predictor.get_compression_stats()
    print(f"\n📊 Stats: {stats['transmitted_readings']}/{stats['total_readings']} transmitted")
    print(f"💾 Bandwidth saved: {stats['compression_ratio']}%")
    
    # Scenario 2: City driving (frequent changes - low compression)
    print("\n\n🏙️  SCENARIO 2: City Driving (Frequent Changes)")
    print("-" * 60)
    predictor.reset()
    
    city_data = [
        (30, 20, 78, 90),
        (25, 5, 77.8, 95),
        (15, 2, 77.6, 100),
        (0, 0, 77.6, 100),
        (10, 15, 77.4, 105),
    ]
    
    for i, (speed, power, battery, heading) in enumerate(city_data, 1):
        decisions = predictor.should_transmit_packet(speed, power, battery, heading)
        fields = [k for k, v in decisions.items() if v and k != 'is_resync']
        print(f"Reading {i}: Speed={speed}, Power={power}, Battery={battery}, Heading={heading}")
        print(f"  → Transmit: {', '.join(fields)}")
    
    stats = predictor.get_compression_stats()
    print(f"\n📊 Stats: {stats['transmitted_readings']}/{stats['total_readings']} transmitted")
    print(f"💾 Bandwidth saved: {stats['compression_ratio']}%")
    
    print("\n" + "=" * 60)
    print("✅ Test complete!")
