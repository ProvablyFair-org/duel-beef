// Code written in javascript

// User input values
const clientSeed = '';
const serverSeed = '';
const nonce = 0;
const deathPointsCount = 1;
const gridSize = 20;

// Converts a hex string (e.g. "deadbeef") into a Uint8Array of bytes
function hexToBytes(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

// Converts a Uint8Array of bytes back into a hex string (e.g. [222, 173, 190, 239] → "deadbeef")
function bytesToHex(bytes) {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

// Computes a HMAC-SHA256 using the Web Crypto API
// keyHex: hex-encoded key (e.g. server seed)
// message: Uint8Array to be signed
async function generateHMAC_SHA256(keyHex, message) {
  const keyBytes = hexToBytes(keyHex);

  // Import raw key for HMAC use
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyBytes,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );

  // Generate HMAC signature
  const signature = await crypto.subtle.sign('HMAC', cryptoKey, message);
  return bytesToHex(new Uint8Array(signature)); // Return signature as hex
}

async function generateDeathPoints(serverSeedHex, clientSeed, nonce, gridSize, deathPointsCount) {
  if (deathPointsCount >= gridSize) throw new Error("deathPointsCount must be less than gridSize");

  const MAX_UINT32 = 0xFFFFFFFF; // 4,294,967,295
  const positions = Array.from({ length: gridSize }, (_, i) => i);

  // Fisher-Yates shuffle (backward)
  for (let i = gridSize - 1; i > 0; i--) {
    const range = i + 1;
    const maxFair = MAX_UINT32 - (MAX_UINT32 % range);
    let cursor = gridSize - 1 - i;

    // Keep generating until we find a fair value
    while (true) {
      const hash = await generateHMAC_SHA256(
        serverSeedHex,
        new TextEncoder().encode(`${clientSeed}:${nonce}:${cursor}`)
      );

      let found = false;
      for (let off = 0; off + 8 <= hash.length; off += 8) {
        const value = parseInt(hash.slice(off, off + 8), 16);
        if (value < maxFair) {
          const j = value % range;
          [positions[i], positions[j]] = [positions[j], positions[i]];
          found = true;
          break;
        }
      }

      if (found) break; // go to next i
      cursor++; // otherwise try a new cursor
    }
  }

  // Take first N positions as death points and sort
  return positions.slice(0, deathPointsCount).sort((a, b) => a - b);
}

// === Run PF verification ===
if (serverSeed && serverSeed.trim() !== '' && clientSeed && clientSeed.trim() !== '' && nonce >= 0 && gridSize > 1 && deathPointsCount > 0 && deathPointsCount < gridSize) {
  const maxSteps = gridSize - deathPointsCount;

  generateDeathPoints(serverSeed, clientSeed, nonce, gridSize, deathPointsCount)
    .then(result => {
        const firstDeathPoint = result[0];
        if (firstDeathPoint < maxSteps) {
          console.log("Death Point: " + firstDeathPoint + " (Step " + (firstDeathPoint + 1) + ")");
        } else {
          console.log("Death Point: null");
        }
    })
    .catch(err => console.error("Error:", err));
} else {
  console.log("Please provide valid serverSeed, clientSeed, nonce (>=0), gridSize (>1), and deathPointsCount (>0 and < gridSize).");
}
