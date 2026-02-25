import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { VeiledChests } from "../target/types/veiled_chests";
import { Connection, Keypair } from "@solana/web3.js";
import {
  getMXEAccAddress,
  getCompDefAccAddress,
  getCompDefAccOffset,
  getArciumProgram,
  getLookupTableAddress,
} from "@arcium-hq/client";
import fs from "fs";
import path from "path";
import { HELIUS_RPC_URL } from "./config";

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

  // Load IDL and derive program ID
  const idl = JSON.parse(
    fs.readFileSync("./target/idl/veiled_chests.json", "utf-8")
  );
  const programId = new anchor.web3.PublicKey(idl.address);

  // Connect — Helius devnet RPC (URL set in scripts/config.ts)
  const connection = new Connection(HELIUS_RPC_URL, "confirmed");

  const wallet = new anchor.Wallet(payer);
  const provider = new anchor.AnchorProvider(connection, wallet, {
    commitment: "confirmed",
  });

  const program = new Program(idl, provider) as Program<VeiledChests>;

  // Derive Arcium accounts
  const mxeAccount = getMXEAccAddress(programId);
  const compDefOffset = Buffer.from(getCompDefAccOffset("play_chest_game")).readUInt32LE();
  const compDefAccount = getCompDefAccAddress(programId, compDefOffset);

  // Derive the Address Lookup Table address from the MXE account
  const arciumProgram = getArciumProgram(provider);
  const mxeAcc = await arciumProgram.account.mxeAccount.fetch(mxeAccount);
  const lutAddress = getLookupTableAddress(programId, mxeAcc.lutOffsetSlot);

  console.log("Initializing computation definition for play_chest_game...");
  console.log("Using payer:", payer.publicKey.toBase58());
  console.log("MXE Account:", mxeAccount.toBase58());
  console.log("Comp Def Account:", compDefAccount.toBase58());
  console.log("LUT Address:", lutAddress.toBase58());

  try {
    const tx = await program.methods
      .initPlayChestGameCompDef()
      .accounts({
        payer: payer.publicKey,
        mxeAccount: mxeAccount,
        compDefAccount: compDefAccount,
        addressLookupTable: lutAddress,
      })
      .rpc({ commitment: "confirmed", preflightCommitment: "confirmed" });

    console.log("✅ Comp def initialized!");
    console.log("Transaction signature:", tx);
    console.log(
      "View on Solana Explorer:",
      `https://explorer.solana.com/tx/${tx}?cluster=devnet`
    );
  } catch (error: any) {
    if (error.message?.includes("already in use")) {
      console.log("⚠️  Comp def already initialized (this is fine)");
    } else {
      console.error("❌ Error initializing comp def:", error);
      throw error;
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
