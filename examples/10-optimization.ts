/**
 * Example: Optimization Features
 * 
 * Demonstrates how to use connection pooling, request batching, and caching
 * features to improve performance when working with Reolink devices.
 * 
 * The reolink-aio library implements three key optimizations:
 * 1. **Connection Pooling**: Reuses TCP connections for better performance
 * 2. **Request Batching**: Splits large requests into optimal chunks
 * 3. **Caching**: Caches API responses to reduce redundant requests
 */

import { Host } from '../src';

// Example device configuration
const DEVICE_IP = '192.168.1.100';
const USERNAME = 'admin';
const PASSWORD = 'your-password';

async function main() {
  try {
    console.log('=== Reolink Optimization Features Demo ===\n');

    // Create Host instance
    // Connection pooling is enabled by default with optimal settings
    const host = new Host(DEVICE_IP, USERNAME, PASSWORD);

    console.log('1. Connection Pooling');
    console.log('   ✓ Enabled by default with keepAlive agents');
    console.log('   ✓ Reuses TCP connections automatically');
    console.log('   ✓ MaxSockets: 10, MaxFreeSockets: 5');
    console.log('   ✓ KeepAliveMsecs: 30000ms (30 seconds)\n');

    // Login (connection is pooled automatically)
    await host.login();
    console.log('   ✓ Logged in successfully\n');

    // ========================================
    // 2. Request Batching
    // ========================================
    console.log('2. Request Batching');
    console.log('   ✓ Large requests automatically split into chunks');
    console.log('   ✓ Max 35 commands per request (API limit)');
    console.log('   ✓ Sequential processing prevents API errors\n');

    // Example: Get host data (automatically batched if needed)
    console.log('   Fetching host data...');
    const start = Date.now();
    await host.getHostData();
    const elapsed = Date.now() - start;
    console.log(`   ✓ Host data retrieved in ${elapsed}ms\n`);

    // ========================================
    // 3. Caching Layer
    // ========================================
    console.log('3. Caching Layer');
    console.log('   ✓ Response caching enabled by default');
    console.log('   ✓ Default TTL: 60 seconds');
    console.log('   ✓ Automatic expired entry cleanup\n');

    // Example: Cache management
    console.log('   Cache Configuration:');
    console.log(`   - Caching enabled: ${(host as any).cacheEnabled}`);
    console.log(`   - Cache TTL: ${(host as any).cacheTTL}ms`);
    console.log(`   - Cached entries: ${(host as any).responseCache.size}\n`);

    // Customize cache settings
    console.log('   Customizing cache settings:');
    host.setCacheTTL(120000); // 2 minutes
    console.log('   ✓ Set cache TTL to 120 seconds\n');

    // ========================================
    // 4. Raw Host Data Caching
    // ========================================
    console.log('4. Raw Host Data Persistence');
    console.log('   ✓ Export/import host data for faster startup\n');

    // Export host data
    const rawData = host.getRawHostData();
    console.log(`   ✓ Exported host data (${rawData.length} bytes)`);
    
    // Save to file or database for next session
    console.log('   → Save this data to skip getHostData() on next run\n');

    // Import on next session
    // const savedData = loadFromFile();
    // host.setRawHostData(savedData);
    // console.log('   ✓ Restored host data from cache');

    // ========================================
    // 5. Performance Comparison
    // ========================================
    console.log('5. Performance Comparison\n');

    // First request (no cache)
    host.clearCache();
    const start1 = Date.now();
    await host.getHostData();
    const elapsed1 = Date.now() - start1;
    console.log(`   First request (no cache): ${elapsed1}ms`);

    // Second request (with cache)
    const start2 = Date.now();
    await host.getHostData();
    const elapsed2 = Date.now() - start2;
    console.log(`   Second request (cached):   ${elapsed2}ms`);
    console.log(`   → Speedup: ${((elapsed1 - elapsed2) / elapsed1 * 100).toFixed(1)}%\n`);

    // ========================================
    // 6. Cache Control
    // ========================================
    console.log('6. Cache Control\n');

    // Disable caching for specific operations
    console.log('   Disabling cache for real-time data...');
    host.setCacheEnabled(false);
    await host.getHostData(); // Fresh data
    console.log('   ✓ Fresh data retrieved\n');

    // Re-enable caching
    console.log('   Re-enabling cache...');
    host.setCacheEnabled(true);
    console.log('   ✓ Cache enabled\n');

    // Clear cache manually
    console.log('   Clearing cache manually...');
    host.clearCache();
    console.log('   ✓ Cache cleared\n');

    // ========================================
    // 7. Best Practices
    // ========================================
    console.log('7. Best Practices\n');
    console.log('   ✓ Keep connection pooling enabled (default)');
    console.log('   ✓ Use caching for frequently accessed data');
    console.log('   ✓ Export rawHostData for faster app startup');
    console.log('   ✓ Disable cache for real-time monitoring');
    console.log('   ✓ Clear cache after configuration changes');
    console.log('   ✓ Let batching handle large requests automatically\n');

    // ========================================
    // 8. Advanced: Connection Pool Stats
    // ========================================
    console.log('8. Connection Pool Information\n');
    console.log('   HTTP Agent Configuration:');
    console.log('   - Keep-Alive: enabled');
    console.log('   - Max Sockets: 10 (per host)');
    console.log('   - Max Free Sockets: 5');
    console.log('   - Keep-Alive Timeout: 30 seconds');
    console.log('   - Scheduling: LIFO (reuse recent sockets)\n');

    // Logout
    await host.logout();
    console.log('✓ Logged out successfully');

  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

// Run if executed directly
if (require.main === module) {
  main().catch(console.error);
}

export { main };
