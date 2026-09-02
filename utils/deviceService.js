// User agar naye device se login kare, toh isse pata chalta hai aur security email bhejta hai.
// deviceId Android app se aayega (jaise ANDROID_ID ya generated UUID) - yeh request body me
// "deviceId" aur "deviceName" ke through bhejna hoga.
//
// IMPORTANT: agar Android app deviceId bhejna bhool jaye (ya abhi implement na kiya ho),
// hum ek fallback deviceId generate karte hain jo IP + browser/app info se banta hai.
// Isse "naya device" detection kabhi silently off nahi hota - test/without-deviceId
// case me bhi security email jaati rahegi, jaisa production app me hona chahiye.

const checkAndRegisterDevice = async (user, deviceId, deviceName, fallbackIdentifier) => {
  const safeFallback = fallbackIdentifier && typeof fallbackIdentifier === "string" && fallbackIdentifier.trim().length > 0
    ? fallbackIdentifier.trim()
    : "unknown";

  const effectiveDeviceId = deviceId && typeof deviceId === "string" && deviceId.trim().length > 0
    ? deviceId.trim()
    : `fallback_${safeFallback}`;

  const effectiveDeviceName = deviceName && typeof deviceName === "string" && deviceName.trim().length > 0
    ? deviceName.trim()
    : "Unknown device";

  // Safety net - agar kisi purane/corrupt document me knownDevices array hi missing ho
  if (!Array.isArray(user.knownDevices)) {
    user.knownDevices = [];
  }

  const existingDevice = user.knownDevices.find((d) => d.deviceId === effectiveDeviceId);

  if (existingDevice) {
    // Pehchana hua device - bas lastLoginAt update kardo
    existingDevice.lastLoginAt = new Date();
    return { isNewDevice: false };
  }

  // Naya device - list me add karo
  user.knownDevices.push({
    deviceId: effectiveDeviceId,
    deviceName: effectiveDeviceName,
    firstLoginAt: new Date(),
    lastLoginAt: new Date(),
  });

  // Bahut purane devices list badhti na jaye isliye max 10 rakhte hain (sabse purane hatate hain)
  if (user.knownDevices.length > 10) {
    user.knownDevices.shift();
  }

  return { isNewDevice: true, deviceName: effectiveDeviceName };
};

module.exports = checkAndRegisterDevice;
