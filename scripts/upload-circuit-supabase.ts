import * as anchor from "@coral-xyz/anchor";
import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

// Supabase credentials - you'll need to set these
const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || '';

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error('Please set SUPABASE_URL and SUPABASE_ANON_KEY environment variables');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

async function uploadCircuit(circuitName: string) {
  const circuitPath = path.join(__dirname, '..', 'build', `${circuitName}.arcis`);
  
  if (!fs.existsSync(circuitPath)) {
    throw new Error(`Circuit file not found: ${circuitPath}`);
  }

  // Read circuit file
  const circuitBuffer = fs.readFileSync(circuitPath);
  
  // Calculate SHA-256 hash
  const hash = crypto.createHash('sha256').update(circuitBuffer).digest('hex');
  console.log(`Circuit: ${circuitName}`);
  console.log(`Size: ${(circuitBuffer.length / 1024).toFixed(2)} KB`);
  console.log(`SHA-256: ${hash}`);

  // Upload to Supabase Storage
  const fileName = `${circuitName}.arcis`;
  const { data, error } = await supabase.storage
    .from('arcium-circuits')
    .upload(fileName, circuitBuffer, {
      contentType: 'application/octet-stream',
      upsert: true, // Overwrite if exists
    });

  if (error) {
    throw new Error(`Failed to upload circuit: ${error.message}`);
  }

  // Get public URL
  const { data: { publicUrl } } = supabase.storage
    .from('arcium-circuits')
    .getPublicUrl(fileName);

  console.log(`✅ Uploaded to: ${publicUrl}`);
  console.log(`Hash for circuit_hash! macro: ${hash}\n`);

  return { publicUrl, hash };
}

async function main() {
  try {
    console.log('📤 Uploading VeiledChests circuit to Supabase...\n');
    
    const result = await uploadCircuit('play_chest_game');
    
    console.log('\n✅ Upload complete!');
    console.log('\n📝 Update your program with:');
    console.log(`   URL: ${result.publicUrl}`);
    console.log(`   Hash: [${result.hash}]`);
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

main();
