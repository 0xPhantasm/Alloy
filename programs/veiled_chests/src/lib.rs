use anchor_lang::prelude::*;
use anchor_lang::system_program;
use arcium_anchor::prelude::*;
use arcium_anchor::LUT_PROGRAM_ID;
use arcium_client::idl::arcium::types::{CallbackAccount, CircuitSource, OffChainCircuitSource};
use arcium_macros::circuit_hash;

const COMP_DEF_OFFSET_PLAY_CHEST_GAME: u32 = comp_def_offset("play_chest_game");

// Seeds for PDAs
pub const TREASURY_SEED: &[u8] = b"treasury";
pub const GAME_SEED: &[u8] = b"game";

declare_id!("BK7k8VuAAZ5Cw9MQNuGT4D7d6ampq3BFGrkdPwAaVfES");

#[arcium_program]
pub mod veiled_chests {
    use super::*;

    /// Initialize the computation definition for play_chest_game
    /// Use None for circuit source on localnet (circuit pre-loaded in genesis)
    /// Use OffChain source with GitHub URL for devnet/mainnet
    pub fn init_play_chest_game_comp_def(ctx: Context<InitPlayChestGameCompDef>) -> Result<()> {
        // For localnet testing, use None - the circuit is pre-loaded from genesis accounts
        // For devnet/mainnet deployment, uncomment the OffChain source below
        init_comp_def(
            ctx.accounts,
            Some(CircuitSource::OffChain(OffChainCircuitSource {
                source: "https://raw.githubusercontent.com/0xPhantasm/Alloy/main/build/play_chest_game.arcis".to_string(),
                hash: circuit_hash!("play_chest_game"),
            })),
            None,
        )?;
        Ok(())
    }

    /// Initialize the treasury PDA (only needs to be called once)
    pub fn init_treasury(ctx: Context<InitTreasury>) -> Result<()> {
        ctx.accounts.treasury.bump = ctx.bumps.treasury;
        ctx.accounts.treasury.authority = ctx.accounts.authority.key();
        msg!("Treasury initialized with authority: {}", ctx.accounts.authority.key());
        Ok(())
    }

    /// Fund the treasury with SOL
    pub fn fund_treasury(ctx: Context<FundTreasury>, amount: u64) -> Result<()> {
        system_program::transfer(
            CpiContext::new(
                ctx.accounts.system_program.to_account_info(),
                system_program::Transfer {
                    from: ctx.accounts.funder.to_account_info(),
                    to: ctx.accounts.treasury.to_account_info(),
                },
            ),
            amount,
        )?;
        msg!("Treasury funded with {} lamports", amount);
        Ok(())
    }

    /// Play the chest game - player picks a chest and places a bet
    pub fn play_chest_game(
        ctx: Context<PlayChestGame>,
        computation_offset: u64,
        num_chests: u8,           // 2-5 chests
        bet_amount: u64,          // Bet in lamports
        player_choice: [u8; 32],  // Encrypted chest choice
        pub_key: [u8; 32],        // Player's encryption pubkey
        nonce: u128,              // Encryption nonce
    ) -> Result<()> {
        // Validate num_chests
        require!(num_chests >= 2 && num_chests <= 5, ErrorCode::InvalidChestCount);
        
        // Validate bet amount (minimum 0.01 SOL = 10_000_000 lamports)
        require!(bet_amount >= 10_000_000, ErrorCode::BetTooSmall);

        // Get game account info early to avoid borrow issues
        let game_account_key = ctx.accounts.game_account.key();
        let treasury_key = ctx.accounts.treasury.key();
        let player_key = ctx.accounts.player.key();

        // Check if player already has an active game
        {
            let game = &ctx.accounts.game_account;
            require!(
                game.status == GameStatus::None as u8 
                    || game.status == GameStatus::Completed as u8 
                    || game.status == GameStatus::Cancelled as u8, 
                ErrorCode::GameAlreadyActive
            );
        }

        // Transfer bet from player to game account (held until result)
        system_program::transfer(
            CpiContext::new(
                ctx.accounts.system_program.to_account_info(),
                system_program::Transfer {
                    from: ctx.accounts.player.to_account_info(),
                    to: ctx.accounts.game_account.to_account_info(),
                },
            ),
            bet_amount,
        )?;

        // Store game state
        let game = &mut ctx.accounts.game_account;
        game.player = player_key;
        game.bet_amount = bet_amount;
        game.num_chests = num_chests;
        game.status = GameStatus::Pending as u8;
        game.created_at = Clock::get()?.unix_timestamp;
        game.computation_offset = computation_offset;
        game.bump = ctx.bumps.game_account;

        ctx.accounts.sign_pda_account.bump = ctx.bumps.sign_pda_account;

        // Build arguments for MPC computation using ArgBuilder (v0.5.1)
        let args = ArgBuilder::new()
            .x25519_pubkey(pub_key)
            .plaintext_u128(nonce)
            .encrypted_u8(player_choice)  // Encrypted player choice
            .plaintext_u8(num_chests)     // Plaintext num_chests
            .build();

        // Queue the MPC computation (v0.7.0 - callback_url removed)
        queue_computation(
            ctx.accounts, 
            computation_offset, 
            args, 
            vec![PlayChestGameCallback::callback_ix(
                computation_offset, 
                &ctx.accounts.mxe_account, 
                &[
                    CallbackAccount {
                        pubkey: game_account_key,
                        is_writable: true,
                    },
                    CallbackAccount {
                        pubkey: treasury_key,
                        is_writable: true,
                    },
                    CallbackAccount {
                        pubkey: player_key,
                        is_writable: true,
                    },
                ]
            )?], 
            1,
            0, // cu_price_micro
        )?;

        msg!("Game started: {} chests, {} lamports bet", num_chests, bet_amount);
        Ok(())
    }

    /// Callback from MPC computation with result
    #[arcium_callback(encrypted_ix = "play_chest_game")]
    pub fn play_chest_game_callback(
        ctx: Context<PlayChestGameCallback>,
        output: SignedComputationOutputs<PlayChestGameOutput>,
    ) -> Result<()> {
        // Verify BLS signature on output (v0.5.1 - takes 2 args)
        // The circuit returns (bool, u8) which becomes PlayChestGameOutput { field_0: PlayChestGameOutputStruct0 { field_0: bool, field_1: u8 } }
        let (player_won, winning_chest) = match output.verify_output(
            &ctx.accounts.cluster_account,
            &ctx.accounts.computation_account,
        ) {
            Ok(PlayChestGameOutput { 
                field_0: PlayChestGameOutputStruct0 { field_0: won, field_1: chest }
            }) => (won, chest),
            Err(_) => return Err(ErrorCode::AbortedComputation.into()),
        };

        let game = &ctx.accounts.game_account;
        require!(game.status == GameStatus::Pending as u8, ErrorCode::GameNotPending);

        let bet_amount = game.bet_amount;
        let num_chests = game.num_chests;
        let player_key = game.player;

        if player_won {
            // Player won! Calculate payout: bet * multiplier
            // Multiplier equals number of chests
            let payout = bet_amount.checked_mul(num_chests as u64)
                .ok_or(ErrorCode::Overflow)?;

            // First return the original bet from game account
            **ctx.accounts.game_account.to_account_info().try_borrow_mut_lamports()? -= bet_amount;
            **ctx.accounts.player.to_account_info().try_borrow_mut_lamports()? += bet_amount;

            // Then pay winnings from treasury (payout - bet = net winnings)
            let winnings = payout.checked_sub(bet_amount).ok_or(ErrorCode::Overflow)?;
            if winnings > 0 {
                **ctx.accounts.treasury.to_account_info().try_borrow_mut_lamports()? -= winnings;
                **ctx.accounts.player.to_account_info().try_borrow_mut_lamports()? += winnings;
            }

            // Update game status
            ctx.accounts.game_account.status = GameStatus::Completed as u8;
            
            emit!(GameResultEvent {
                player: player_key,
                player_won: true,
                winning_chest,
                num_chests,
                bet_amount,
                payout,
            });

            msg!("Player WON! Chest {} was correct. Paid out {} lamports", winning_chest, payout);
        } else {
            // Player lost - bet goes to treasury
            **ctx.accounts.game_account.to_account_info().try_borrow_mut_lamports()? -= bet_amount;
            **ctx.accounts.treasury.to_account_info().try_borrow_mut_lamports()? += bet_amount;

            // Update game status
            ctx.accounts.game_account.status = GameStatus::Completed as u8;

            emit!(GameResultEvent {
                player: player_key,
                player_won: false,
                winning_chest,
                num_chests,
                bet_amount,
                payout: 0,
            });

            msg!("Player lost. Winning chest was {}. Bet kept by treasury.", winning_chest);
        }

        Ok(())
    }

    /// Cancel a game and refund the player (for timeouts or failures)
    pub fn cancel_game(ctx: Context<CancelGame>) -> Result<()> {
        let game = &ctx.accounts.game_account;
        
        // Only allow cancellation of pending games
        require!(game.status == GameStatus::Pending as u8, ErrorCode::GameNotPending);
        
        // Only allow cancellation after timeout (60 seconds)
        let current_time = Clock::get()?.unix_timestamp;
        require!(current_time - game.created_at > 60, ErrorCode::GameNotTimedOut);

        // Refund the bet to player
        let bet_amount = game.bet_amount;
        let player_key = game.player;
        
        **ctx.accounts.game_account.to_account_info().try_borrow_mut_lamports()? -= bet_amount;
        **ctx.accounts.player.to_account_info().try_borrow_mut_lamports()? += bet_amount;

        ctx.accounts.game_account.status = GameStatus::Cancelled as u8;

        emit!(GameCancelledEvent {
            player: player_key,
            bet_amount,
        });

        msg!("Game cancelled, {} lamports refunded", bet_amount);
        Ok(())
    }
}

// ============= Account Structs =============

#[account]
pub struct Treasury {
    pub authority: Pubkey,
    pub bump: u8,
}

#[account]
pub struct GameAccount {
    pub player: Pubkey,
    pub bet_amount: u64,
    pub num_chests: u8,
    pub status: u8,
    pub created_at: i64,
    pub computation_offset: u64,
    pub bump: u8,
}

#[repr(u8)]
#[derive(Clone, Copy, PartialEq)]
pub enum GameStatus {
    None = 0,
    Pending = 1,
    Completed = 2,
    Cancelled = 3,
}

// Space: 32 (player) + 8 (bet) + 1 (chests) + 1 (status) + 8 (created) + 8 (offset) + 1 (bump) + 8 (discriminator) = 67
impl GameAccount {
    pub const SPACE: usize = 8 + 32 + 8 + 1 + 1 + 8 + 8 + 1;
}

impl Treasury {
    pub const SPACE: usize = 8 + 32 + 1;
}

// ============= Context Structs =============

#[derive(Accounts)]
pub struct InitTreasury<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(
        init,
        payer = authority,
        space = Treasury::SPACE,
        seeds = [TREASURY_SEED],
        bump,
    )]
    pub treasury: Account<'info, Treasury>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct FundTreasury<'info> {
    #[account(mut)]
    pub funder: Signer<'info>,
    #[account(
        mut,
        seeds = [TREASURY_SEED],
        bump = treasury.bump,
    )]
    pub treasury: Account<'info, Treasury>,
    pub system_program: Program<'info, System>,
}

#[queue_computation_accounts("play_chest_game", player)]
#[derive(Accounts)]
#[instruction(computation_offset: u64, num_chests: u8, bet_amount: u64)]
pub struct PlayChestGame<'info> {
    #[account(mut)]
    pub player: Signer<'info>,
    
    #[account(
        init_if_needed,
        payer = player,
        space = GameAccount::SPACE,
        seeds = [GAME_SEED, player.key().as_ref()],
        bump,
    )]
    pub game_account: Box<Account<'info, GameAccount>>,

    #[account(
        mut,
        seeds = [TREASURY_SEED],
        bump = treasury.bump,
    )]
    pub treasury: Box<Account<'info, Treasury>>,

    #[account(
        init_if_needed,
        space = 9,
        payer = player,
        seeds = [b"ArciumSignerAccount"],
        bump,
        address = derive_sign_pda!(),
    )]
    pub sign_pda_account: Account<'info, ArciumSignerAccount>,
    
    #[account(address = derive_mxe_pda!())]
    pub mxe_account: Box<Account<'info, MXEAccount>>,
    
    #[account(mut, address = derive_mempool_pda!(mxe_account, ErrorCode::ClusterNotSet))]
    /// CHECK: mempool_account, checked by the arcium program.
    pub mempool_account: UncheckedAccount<'info>,
    
    #[account(mut, address = derive_execpool_pda!(mxe_account, ErrorCode::ClusterNotSet))]
    /// CHECK: executing_pool, checked by the arcium program.
    pub executing_pool: UncheckedAccount<'info>,
    
    #[account(mut, address = derive_comp_pda!(computation_offset, mxe_account, ErrorCode::ClusterNotSet))]
    /// CHECK: computation_account, checked by the arcium program.
    pub computation_account: UncheckedAccount<'info>,
    
    #[account(address = derive_comp_def_pda!(COMP_DEF_OFFSET_PLAY_CHEST_GAME))]
    pub comp_def_account: Box<Account<'info, ComputationDefinitionAccount>>,
    
    #[account(mut, address = derive_cluster_pda!(mxe_account, ErrorCode::ClusterNotSet))]
    pub cluster_account: Box<Account<'info, Cluster>>,
    
    #[account(mut, address = ARCIUM_FEE_POOL_ACCOUNT_ADDRESS)]
    pub pool_account: Box<Account<'info, FeePool>>,
    
    #[account(mut, address = ARCIUM_CLOCK_ACCOUNT_ADDRESS)]
    pub clock_account: Box<Account<'info, ClockAccount>>,
    
    pub system_program: Program<'info, System>,
    pub arcium_program: Program<'info, Arcium>,
}

#[callback_accounts("play_chest_game")]
#[derive(Accounts)]
pub struct PlayChestGameCallback<'info> {
    pub arcium_program: Program<'info, Arcium>,
    
    #[account(address = derive_comp_def_pda!(COMP_DEF_OFFSET_PLAY_CHEST_GAME))]
    pub comp_def_account: Box<Account<'info, ComputationDefinitionAccount>>,
    
    #[account(address = derive_mxe_pda!())]
    pub mxe_account: Box<Account<'info, MXEAccount>>,
    
    /// CHECK: computation_account, checked by arcium program via constraints in the callback context.
    pub computation_account: UncheckedAccount<'info>,
    
    #[account(address = derive_cluster_pda!(mxe_account, ErrorCode::ClusterNotSet))]
    pub cluster_account: Box<Account<'info, Cluster>>,
    
    #[account(address = ::anchor_lang::solana_program::sysvar::instructions::ID)]
    /// CHECK: instructions_sysvar, checked by the account constraint
    pub instructions_sysvar: AccountInfo<'info>,

    // Custom accounts passed via CallbackAccount
    #[account(mut)]
    pub game_account: Box<Account<'info, GameAccount>>,

    #[account(mut)]
    pub treasury: Box<Account<'info, Treasury>>,

    /// CHECK: player account for receiving winnings
    #[account(mut)]
    pub player: AccountInfo<'info>,
}

#[derive(Accounts)]
pub struct CancelGame<'info> {
    /// CHECK: player receiving refund
    #[account(mut)]
    pub player: AccountInfo<'info>,

    #[account(
        mut,
        seeds = [GAME_SEED, player.key().as_ref()],
        bump = game_account.bump,
        constraint = game_account.player == player.key() @ ErrorCode::NotGamePlayer,
    )]
    pub game_account: Account<'info, GameAccount>,
}

#[init_computation_definition_accounts("play_chest_game", payer)]
#[derive(Accounts)]
pub struct InitPlayChestGameCompDef<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(mut, address = derive_mxe_pda!())]
    pub mxe_account: Box<Account<'info, MXEAccount>>,
    #[account(mut)]
    /// CHECK: comp_def_account, checked by arcium program.
    pub comp_def_account: UncheckedAccount<'info>,
    #[account(mut, address = derive_mxe_lut_pda!(mxe_account.lut_offset_slot))]
    /// CHECK: address_lookup_table, checked by arcium program.
    pub address_lookup_table: UncheckedAccount<'info>,
    #[account(address = LUT_PROGRAM_ID)]
    /// CHECK: lut_program is the Address Lookup Table program.
    pub lut_program: UncheckedAccount<'info>,
    pub arcium_program: Program<'info, Arcium>,
    pub system_program: Program<'info, System>,
}

// ============= Events =============

#[event]
pub struct GameResultEvent {
    pub player: Pubkey,
    pub player_won: bool,
    pub winning_chest: u8,
    pub num_chests: u8,
    pub bet_amount: u64,
    pub payout: u64,
}

#[event]
pub struct GameCancelledEvent {
    pub player: Pubkey,
    pub bet_amount: u64,
}

// ============= Errors =============

#[error_code]
pub enum ErrorCode {
    #[msg("The computation was aborted")]
    AbortedComputation,
    #[msg("Cluster not set")]
    ClusterNotSet,
    #[msg("Invalid chest count - must be 2-5")]
    InvalidChestCount,
    #[msg("Bet amount too small - minimum 0.01 SOL")]
    BetTooSmall,
    #[msg("Player already has an active game")]
    GameAlreadyActive,
    #[msg("Game is not in pending status")]
    GameNotPending,
    #[msg("Game has not timed out yet")]
    GameNotTimedOut,
    #[msg("Arithmetic overflow")]
    Overflow,
    #[msg("Not the game player")]
    NotGamePlayer,
}
