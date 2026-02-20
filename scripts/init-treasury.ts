import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PublicKey, SystemProgram, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { VeiledChests } from "../target/types/veiled_chests";

const PROGRAM_ID = new PublicKey("8RBcYQFnSwmU8Yd8n9rmg85G5bfWeTcEAjN3LPC22ooG");

async function main() {
  // Setup provider
  const connection = new anchor.web3.Connection(
    "https://devnet.helius-rpc.com/?api-key=98664a07-fdde-46f8-ac7d-7efd848339c4",
    "confirmed"
  );
  
  const wallet = anchor.Wallet.local();
  const provider = new anchor.AnchorProvider(connection, wallet, {
    commitment: "confirmed",
  });
  anchor.setProvider(provider);

  // Load program
  const idl = require("../target/idl/veiled_chests.json");
  const program = new Program(idl, provider) as Program<VeiledChests>;

  // Derive treasury PDA
  const [treasuryPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("treasury")],
    PROGRAM_ID
  );

  console.log("Treasury PDA:", treasuryPda.toBase58());
  console.log("Authority:", wallet.publicKey.toBase58());

  // Check if treasury already exists
  const treasuryInfo = await connection.getAccountInfo(treasuryPda);
  if (treasuryInfo) {
    console.log("Treasury already initialized!");
    console.log("Balance:", treasuryInfo.lamports / LAMPORTS_PER_SOL, "SOL");
    return;
  }

  // Initialize treasury
  console.log("\nInitializing treasury...");
  const tx = await program.methods
    .initTreasury()
    .accountsPartial({
      authority: wallet.publicKey,
    })
    .rpc();

  console.log("✅ Treasury initialized!");
  console.log("Transaction:", tx);
  console.log("\nTo fund the treasury, send SOL to:");
  console.log(treasuryPda.toBase58());
}

main().catch(console.error);
