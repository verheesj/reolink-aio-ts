/**
 * Example 3: Real-time Motion Detection Monitor
 * 
 * This example demonstrates how to:
 * - Monitor motion detection in real-time
 * - Subscribe to Baichuan events
 * - Display motion events as they occur
 * - Track motion state changes
 * 
 * Usage:
 * 1. Update the IP and credentials below
 * 2. Run: npx tsx examples/03-motion-monitor.ts
 * 3. Trigger motion by walking in front of a camera
 * 4. You should see real-time event notifications
 * 5. Press Ctrl+C to stop
 * 
 * To enable debug logging:
 * REOLINK_AIO_DEBUG=1 npx tsx examples/03-motion-monitor.ts
 */

import { Host } from '../src/api/host';

// Handle unhandled promise rejections to prevent crashes
process.on('unhandledRejection', (reason, promise) => {
  // Filter out expected ECONNRESET errors from cmd_id 199 and cmd_id 31
  // These are normal - the device doesn't support these commands
  if (reason instanceof Error) {
    const errorCode = (reason as any).code;
    const errorMessage = reason.message;
    
    // Silently ignore expected ECONNRESET errors
    if (errorCode === 'ECONNRESET' || 
        errorMessage.includes('ECONNRESET') || 
        errorMessage.includes('cmd_id 199') || 
        errorMessage.includes('cmd_id 31')) {
      return;
    }
  }
  
  // Log unexpected errors
  console.error('❗ Unhandled Promise Rejection:', reason);
  console.error('Promise:', promise);
});

async function motionMonitor() {
  // UPDATE THESE VALUES FOR YOUR CAMERA/NVR
  const host = new Host(process.env.REOLINK_NVR_HOST ?? '192.168.1.100', process.env.REOLINK_NVR_USER ?? 'admin', process.env.REOLINK_NVR_PASS ?? 'your_password');

  try {
    console.log('🔌 Connecting to device...');
    await host.getHostData();
    console.log('✅ Connected!\n');

    // Get initial states
    try {
      await host.getStates();
    } catch (err) {
      console.warn('Warning: Could not get initial states:', err instanceof Error ? err.message : String(err));
    }
    
    console.log('📊 Initial States:');
    for (const channel of host.channelsValue) {
      const motion = host.motionDetected(channel);
      const person = host.aiDetected(channel, 'person') || host.aiDetected(channel, 'people');
      const vehicle = host.aiDetected(channel, 'vehicle');
      const pet = host.aiDetected(channel, 'dog_cat');  // Animal/pet detection
      const face = host.aiDetected(channel, 'face');
      const package_ = host.aiDetected(channel, 'package');
      const visitor = host.visitorDetected(channel);
      // Perimeter (Smart AI)
      const crossline = host.crosslineDetected(channel);
      const intrusion = host.intrusionDetected(channel);
      const loitering = host.loiteringDetected(channel);
      const forgotten = host.forgottenDetected(channel);
      const taken = host.takenDetected(channel);
      
      console.log(`\n   Channel ${channel} (${host.cameraName(channel)}):`);
      console.log(`      Motion: ${motion ? '🔴 DETECTED' : '🟢 Clear'}`);
      console.log(`      Person: ${person ? '🔴 DETECTED' : '🟢 Clear'}`);
      console.log(`      Vehicle: ${vehicle ? '🔴 DETECTED' : '🟢 Clear'}`);
      console.log(`      Pet/Animal: ${pet ? '🔴 DETECTED' : '🟢 Clear'}`);
      console.log(`      Face: ${face ? '🔴 DETECTED' : '🟢 Clear'}`);
      console.log(`      Package: ${package_ ? '🔴 DETECTED' : '🟢 Clear'}`);
      console.log(`      Visitor: ${visitor ? '🔴 DETECTED' : '🟢 Clear'}`);
      console.log(`      Crossline: ${crossline?.size ? '🔴 DETECTED' : '🟢 Clear'}`);
      console.log(`      Intrusion: ${intrusion?.size ? '🔴 DETECTED' : '🟢 Clear'}`);
      console.log(`      Loitering: ${loitering?.size ? '🔴 DETECTED' : '🟢 Clear'}`);
      console.log(`      Forgotten: ${forgotten?.size ? '🔴 DETECTED' : '🟢 Clear'}`);
      console.log(`      Taken: ${taken?.size ? '🔴 DETECTED' : '🟢 Clear'}`);
    }

    // Subscribe to events
    console.log('\n🔔 Subscribing to real-time events...');
    console.log('   (Press Ctrl+C to stop)\n');

    await host.baichuan.subscribeEvents();

    // Monitor state changes
    const channelCallback: host.baichuan.CallbackFunction = (cmdId: number | null = null, channel: number | null = null) => {
      if (channel === null) {
        return;
      }
      try {
        const motion = host.motionDetected(channel);
        const person = host.aiDetected(channel, 'person') || host.aiDetected(channel, 'people');
        const vehicle = host.aiDetected(channel, 'vehicle');
        const pet = host.aiDetected(channel, 'dog_cat');  // Animal/pet detection
        const face = host.aiDetected(channel, 'face');
        const package_ = host.aiDetected(channel, 'package');
        const visitor = host.visitorDetected(channel);
        // Perimeter (Smart AI)
        const crossline = host.crosslineDetected(channel);
        const intrusion = host.intrusionDetected(channel);
        const loitering = host.loiteringDetected(channel);
        const forgotten = host.forgottenDetected(channel);
        const taken = host.takenDetected(channel);
        
        // Only log when there's activity
        if (motion || person || vehicle || pet || face || package_ || visitor || crossline?.size || intrusion?.size || loitering?.size || forgotten?.size || taken?.size) {
          const timestamp = new Date().toLocaleTimeString();
          console.log(`[${timestamp}] Channel ${channel} (${host.cameraName(channel)}):`);
          if (motion) console.log('   ⚠️  Motion detected!');
          if (person) console.log('   👤 Person detected!');
          if (vehicle) console.log('   🚗 Vehicle detected!');
          if (pet) console.log('   🐾 Pet/Animal detected!');
          if (face) console.log('   😊 Face detected!');
          if (package_) console.log('   📦 Package detected!');
          if (visitor) console.log('   🚪 Visitor detected!');
          if (crossline?.size) console.log('   ↔️  Crossline detected!');
          if (intrusion?.size) console.log('   🥷 Intrusion detected!');
          if (loitering?.size) console.log('   💤 Loitering detected!');
          if (forgotten?.size) console.log('   🧱 Forgotten detected!');
          if (taken?.size) console.log('   🤷 Taken detected!');
          console.log('');
        }
      } catch (err) {
        console.error('Error checking states:', err);
      }
    };
    for (const channel of host.channelsValue) {
      host.baichuan.registerCallback('motion', channelCallback, 33, channel);
    }

    // Handle graceful shutdown
    process.on('SIGINT', async () => {
      console.log('\n\n🛑 Stopping monitor...');
      await host.baichuan.unsubscribeEvents();
      await host.logout();
      console.log('👋 Disconnected');
      process.exit(0);
    });

    // Keep the process running
    await new Promise(() => {}); // Run indefinitely

  } catch (error) {
    console.error('❌ Error:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

// Run the example
if (require.main === module) {
  motionMonitor().catch(console.error);
}

export { motionMonitor };

