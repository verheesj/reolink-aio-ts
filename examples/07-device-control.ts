/**
 * Example 07: Device Control
 * 
 * Demonstrates how to control various camera features:
 * - IR lights (infrared illumination)
 * - Spotlight/floodlight
 * - Siren/audio alarm
 * - Focus and zoom (for supported cameras)
 * 
 * DIFFICULTY: 🟢 Beginner
 */

import { Host } from '../src';

async function main() {
  // UPDATE THESE VALUES
  const cameraIp = '192.168.0.79';
  const username = 'admin';
  const password = 'ABC123abc';
  const channel = 1; // Channel to control

  console.log('🎛️  Device Control Example\n');
  console.log('=' .repeat(50));

  // Create host and connect
  const host = new Host(cameraIp, username, password);
  console.log(`\n📡 Connecting to ${cameraIp}...`);
  
  await host.getHostData();
  console.log(`✅ Connected to: ${host.nvrName}`);
  console.log(`   Model: ${host.cameraModel(channel)}`);
  console.log(`   Firmware: ${host.cameraSwVersion(channel)}`);

  // IR Lights Control
  console.log('\n💡 IR Lights Control');
  console.log('-'.repeat(50));
  
  try {
    console.log('   Enabling IR lights (Auto mode)...');
    await host.setIrLights(channel, true);
    console.log('   ✅ IR lights enabled');
    
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    console.log('   Disabling IR lights...');
    await host.setIrLights(channel, false);
    console.log('   ✅ IR lights disabled');
  } catch (err) {
    console.log(`   ⚠️  IR lights not supported: ${err}`);
  }

  // Spotlight Control
  console.log('\n🔦 Spotlight Control');
  console.log('-'.repeat(50));
  
  try {
    console.log('   Turning on spotlight at 50% brightness...');
    await host.setSpotlight(channel, true, 50);
    console.log('   ✅ Spotlight on at 50%');
    
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    console.log('   Increasing to 100% brightness...');
    await host.setSpotlight(channel, true, 100);
    console.log('   ✅ Spotlight at 100%');
    
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    console.log('   Turning off spotlight...');
    await host.setSpotlight(channel, false);
    console.log('   ✅ Spotlight off');
  } catch (err) {
    console.log(`   ⚠️  Spotlight not supported: ${err}`);
  }

  // Siren Control
  console.log('\n🚨 Siren Control');
  console.log('-'.repeat(50));
  
  try {
    console.log('   Sounding siren for 2 seconds...');
    await host.setSiren(channel, true, 2);
    console.log('   ✅ Siren activated');
    
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    console.log('   Stopping siren...');
    await host.setSiren(channel, false);
    console.log('   ✅ Siren stopped');
  } catch (err) {
    console.log(`   ⚠️  Siren not supported: ${err}`);
  }

  // Zoom Control
  console.log('\n🔍 Zoom Control');
  console.log('-'.repeat(50));
  
  try {
    console.log('   Setting zoom to position 10...');
    await host.setZoom(channel, 10);
    console.log('   ✅ Zoom set to 10');
    
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    console.log('   Resetting zoom to position 0...');
    await host.setZoom(channel, 0);
    console.log('   ✅ Zoom reset to 0');
  } catch (err) {
    console.log(`   ⚠️  Zoom not supported: ${err}`);
  }

  // Focus Control
  console.log('\n🎯 Focus Control');
  console.log('-'.repeat(50));
  
  try {
    console.log('   Setting focus to position 128...');
    await host.setFocus(channel, 128);
    console.log('   ✅ Focus set to 128');
    
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    console.log('   Setting focus to position 64...');
    await host.setFocus(channel, 64);
    console.log('   ✅ Focus set to 64');
  } catch (err) {
    console.log(`   ⚠️  Focus control not supported: ${err}`);
  }

  // Cleanup
  console.log('\n🔌 Disconnecting...');
  await host.logout();
  console.log('✅ Done!\n');
}

// Run the example
if (require.main === module) {
  main().catch(err => {
    console.error('\n❌ Error:', err.message);
    process.exit(1);
  });
}

export default main;
