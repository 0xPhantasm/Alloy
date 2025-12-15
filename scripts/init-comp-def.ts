import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { VeiledChests } from "../target/types/veiled_chests";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import {
  getMXEAccAddress,
  getCompDefAccAddress,
  getCompDefAccOffset,
  getArciumProgramId,
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

  // Connect to devnet with Helius RPC
  const connection = new Connection(
    "https://devnet.helius-rpc.com/?api-key=98664a07-fdde-46f8-ac7d-7efd848339c4",
    "confirmed"
  );

  const wallet = new anchor.Wallet(payer);
  const provider = new anchor.AnchorProvider(connection, wallet, {
    commitment: "confirmed",
  });

  // Load program
  const programId = new anchor.web3.PublicKey(
    "DDA1LfvE1kM8h4CcyqX4278oCYyB7QAg693QREjfNsZS"
  );
  const idl = JSON.parse(
    fs.readFileSync("./target/idl/veiled_chests.json", "utf-8")
  );
  const program = new Program(idl, provider) as Program<VeiledChests>;

  // Derive Arcium accounts
  const mxeAccount = getMXEAccAddress(programId);
  const compDefOffset = Buffer.from(getCompDefAccOffset("play_chest_game")).readUInt32LE();
  const compDefAccount = getCompDefAccAddress(programId, compDefOffset);
  const arciumProgramId = getArciumProgramId();

  console.log("Initializing computation definition for play_chest_game...");
  console.log("Using payer:", payer.publicKey.toBase58());
  console.log("MXE Account:", mxeAccount.toBase58());
  console.log("Comp Def Account:", compDefAccount.toBase58());
  console.log("Arcium Program:", arciumProgramId.toBase58());

  try {
    const tx = await program.methods
      .initPlayChestGameCompDef()
      .accountsPartial({
        payer: payer.publicKey,
        mxeAccount: mxeAccount,
        compDefAccount: compDefAccount,
        arciumProgram: arciumProgramId,
      })
      .rpc({ skipPreflight: true });

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
