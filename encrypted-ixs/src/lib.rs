use arcis::*;

#[encrypted]
mod circuits {
    use arcis::*;

    /// Player's encrypted chest choice wrapped in a struct.
    /// This matches the Arcium pattern of wrapping encrypted values in structs.
    pub struct PlayerChoice {
        pub choice: u8,  // Chest number (0 to num_chests-1)
    }

    /// VeiledChests: A provably fair chest guessing game
    /// 
    /// The player picks a chest (0 to num_chests-1) and encrypts their choice.
    /// The MPC network generates a random winning chest and compares.
    /// Returns: (player_won: bool, winning_chest: u8) as plaintext for verification.
    
    #[instruction]
    pub fn play_chest_game(
        player_choice_ctxt: Enc<Shared, PlayerChoice>,  // Player's encrypted chest choice
        num_chests: u8,                                  // Number of chests (2-5, plaintext)
    ) -> (bool, u8) {
        // Decrypt player's choice inside MPC
        let player_choice = player_choice_ctxt.to_arcis();
        
        // Generate random winning chest (0 to num_chests-1)
        // v0.5.1 API: gen_integer_in_range(min, max, n_attempts) -> (value, success)
        // We use num_chests as max (exclusive), so valid range is 0 to num_chests-1
        // Use moderate attempt count — with range 2-5, rejection sampling almost
        // always succeeds on first try. Modulo below is the safety net.
        let (winning_chest_u128, _success) = ArcisRNG::gen_integer_in_range(
            0u128, 
            num_chests as u128, 
            10  // n_attempts for rejection sampling (10 is plenty for range ≤5)
        );
        // Safety: clamp to valid range in case rejection sampling exhausted all attempts
        let winning_chest = (winning_chest_u128 % (num_chests as u128)) as u8;
        
        // Check if player won
        let player_won = player_choice.choice == winning_chest;
        
        // Return plaintext result - both values are revealed publicly
        // This proves fairness: winning chest was determined after player committed
        (player_won.reveal(), winning_chest.reveal())
    }
}
