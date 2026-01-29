/**
 * Rolling hash implementation for tamper detection.
 *
 * Each event's hash includes the previous event's hash, creating a chain.
 * If any event is modified, all subsequent hashes become invalid.
 *
 * NOTE: This uses Web Crypto API (available in browsers and Node 18+).
 * Future versions may anchor these hashes to external timestamping services.
 */

/**
 * Compute SHA-256 hash of a string
 * @param {string} data - The data to hash
 * @returns {Promise<string>} - Hex-encoded hash
 */
export async function sha256(data) {
  const encoder = new TextEncoder();
  const dataBuffer = encoder.encode(data);

  // Use Web Crypto API (works in browser and Node 18+)
  const hashBuffer = await crypto.subtle.digest('SHA-256', dataBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

  return hashHex;
}

/**
 * Compute the hash for an event in the chain
 * @param {Object} event - The event object (without hash)
 * @param {string} previousHash - Hash of the previous event (empty string for first event)
 * @returns {Promise<string>} - The computed hash for this event
 */
export async function computeEventHash(event, previousHash = '') {
  // Create a deterministic string representation of the event
  const eventData = JSON.stringify({
    type: event.type,
    timestamp: event.timestamp,
    position: event.position,
    content: event.content,
    // Include previous hash in the computation
    previousHash: previousHash
  });

  return sha256(eventData);
}

/**
 * Verify the hash chain of a list of events
 * @param {Array} events - Array of events with hashes
 * @returns {Promise<{valid: boolean, brokenAt: number|null, message: string}>}
 */
export async function verifyHashChain(events, startingHash = '') {
  if (!events || events.length === 0) {
    return { valid: true, brokenAt: null, message: 'No events to verify', lastHash: startingHash };
  }

  let previousHash = startingHash;

  for (let i = 0; i < events.length; i++) {
    const event = events[i];
    const expectedHash = await computeEventHash(event, previousHash);

    if (event.hash !== expectedHash) {
      console.error('Hash verification failed:', {
        eventIndex: i,
        eventType: event.type,
        eventTimestamp: event.timestamp,
        eventPosition: event.position,
        eventContent: event.content?.substring(0, 50),
        storedHash: event.hash,
        expectedHash: expectedHash,
        previousHash: previousHash
      });
      return {
        valid: false,
        brokenAt: i,
        message: `Hash chain broken at event ${i} (type: ${event.type}, timestamp: ${event.timestamp})`,
        lastHash: previousHash
      };
    }

    previousHash = event.hash;
  }

  return { valid: true, brokenAt: null, message: 'Hash chain verified successfully', lastHash: previousHash };
}

/**
 * Verify hash chains across all sessions in a provenance file
 * @param {Object} provenanceData - The full provenance file data
 * @returns {Promise<{valid: boolean, results: Array}>}
 */
export async function verifyProvenanceFile(provenanceData) {
  const results = [];
  let allValid = true;

  for (const session of provenanceData.sessions) {
    // Verify each session's hash chain independently
    // Each session starts with an empty previousHash by design
    const result = await verifyHashChain(session.events, '');
    results.push({
      sessionId: session.id,
      ...result
    });

    if (!result.valid) {
      allValid = false;
    }
  }

  return { valid: allValid, results };
}
