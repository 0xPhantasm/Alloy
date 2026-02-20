import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { VeiledChests } from "../target/types/veiled_chests";
import { Connection, Keypair, PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js";
import {
  getMXEAccAddress,
  getCompDefAccOffset,
  getArciumAccountBaseSeed,
  getArciumProgramId,
  getMXEPublicKey,
  buildFinalizeCompDefTx,
  getLookupTableAddress,
  getArciumProgram,
} from "@arcium-hq/client";
import fs from "fs";
import path from "path";

async function main() {
  // Load keypair
  const keypairPath = path.join(
    process.env.HOME || "",
    ".config",
    "solana",
    "id.json"
  );
  const keypairData = JSON.parse(fs.readFileSync(keypairPath, "utf-8"));
  const payer = Keypair.fromSecretKey(new Uint8Array(keypairData));

  // Connect to localnet
  const connection = new Connection("http://127.0.0.1:8899", "confirmed");
  const wallet = new anchor.Wallet(payer);
  const provider = new anchor.AnchorProvider(connection, wallet, {
    commitment: "confirmed",
  });

  // Load program
  const idl = JSON.parse(
    fs.readFileSync("./target/idl/veiled_chests.json", "utf-8")
  );
  const program = new Program(idl, provider) as Program<VeiledChests>;
  const programId = program.programId;

  console.log("Setting up localnet for program:", programId.toBase58());
  console.log("Payer:", payer.publicKey.toBase58());

  // Step 1: Wait for MXE keygen
  console.log("\n--- Step 1: Waiting for MXE keygen ---");
  let mxePubkey: Uint8Array | null = null;
  for (let i = 1; i <= 120; i++) {
    try {
      mxePubkey = await getMXEPublicKey(provider, programId);
      if (mxePubkey) {
        console.log("✅ MXE keygen complete! Public key:", Buffer.from(mxePubkey).toString("hex"));
        break;
      }
    } catch {}
    if (i % 10 === 0) console.log(`  Still waiting... (${i}s)`);
    await new Promise((r) => setTimeout(r, 1000));
  }
  if (!mxePubkey) {
    console.error("❌ MXE keygen did not complete after 120s");
    process.exit(1);
  }

  // Step 2: Init comp def
  console.log("\n--- Step 2: Initializing computation definition ---");
  try {
    const baseSeedCompDefAcc = getArciumAccountBaseSeed("ComputationDefinitionAccount");
    const offset = getCompDefAccOffset("play_chest_game");
    const compDefPDA = PublicKey.findProgramAddressSync(
      [baseSeedCompDefAcc, programId.toBuffer(), offset],
      getArciumProgramId()
    )[0];

    // Get LUT address (v0.7.0+)
    const arciumProgram = getArciumProgram(provider);
    const mxeAccount = getMXEAccAddress(programId);
    const mxeAcc = await arciumProgram.account.mxeAccount.fetch(mxeAccount);
    const lutAddress = getLookupTableAddress(programId, mxeAcc.lutOffsetSlot);

    const sig = await program.methods
      .initPlayChestGameCompDef()
      .accounts({
        compDefAccount: compDefPDA,
        payer: payer.publicKey,
        mxeAccount: mxeAccount,
        addressLookupTable: lutAddress,
      } as any)
      .signers([payer])
      .rpc({ commitment: "confirmed", preflightCommitment: "confirmed" });
    console.log("  Init comp def tx:", sig);

    // Finalize comp def
    const finalizeTx = await buildFinalizeCompDefTx(
      provider,
      Buffer.from(offset).readUInt32LE(),
      programId
    );
    const latestBlockhash = await connection.getLatestBlockhash();
    finalizeTx.recentBlockhash = latestBlockhash.blockhash;
    finalizeTx.lastValidBlockHeight = latestBlockhash.lastValidBlockHeight;
    finalizeTx.sign(payer);
    await provider.sendAndConfirm(finalizeTx);
    console.log("✅ Comp def initialized and finalized");
  } catch (error: any) {
    if (error.message?.includes("already in use")) {
      console.log("⚠️  Comp def already initialized (skipping)");
    } else {
      console.error("❌ Error:", error.message || error);
      process.exit(1);
    }
  }

  // Step 3: Init treasury
  console.log("\n--- Step 3: Initializing treasury ---");
  try {
    const sig = await program.methods
      .initTreasury()
      .accountsPartial({
        authority: payer.publicKey,
      })
      .signers([payer])
      .rpc({ commitment: "confirmed", preflightCommitment: "confirmed" });
    console.log("✅ Treasury initialized:", sig);
  } catch (error: any) {
    if (error.message?.includes("already in use")) {
      console.log("⚠️  Treasury already initialized (skipping)");
    } else {
      console.error("❌ Error:", error.message || error);
      process.exit(1);
    }
  }

  // Step 4: Fund treasury
  console.log("\n--- Step 4: Funding treasury ---");
  try {
    const fundAmount = new anchor.BN(10 * LAMPORTS_PER_SOL);
    const sig = await program.methods
      .fundTreasury(fundAmount)
      .accountsPartial({
        funder: payer.publicKey,
      })
      .signers([payer])
      .rpc({ commitment: "confirmed", preflightCommitment: "confirmed" });
    console.log("✅ Treasury funded with 10 SOL:", sig);
  } catch (error: any) {
    console.error("❌ Error funding treasury:", error.message || error);
    process.exit(1);
  }

  console.log("\n🎉 Localnet setup complete! Frontend is ready to use.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
