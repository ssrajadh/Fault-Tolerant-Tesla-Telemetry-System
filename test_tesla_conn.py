import teslapy, config
with teslapy.Tesla(config.EMAIL) as tesla:
    vehicle = tesla.vehicle_list()[0]
    print(f"Connected to: {vehicle['display_name']}")