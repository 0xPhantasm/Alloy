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
        // Using the same approach as Arcium's rock_paper_scissors/against-house:
        // combine random bits. 3 bits give us 0-7; modulo maps into [0, num_chests).
        let b0 = ArcisRNG::bool() as u8;
        let b1 = ArcisRNG::bool() as u8;
        let b2 = ArcisRNG::bool() as u8;
        let random_3bit = b0 + (b1 * 2) + (b2 * 4); // 0..=7
        let winning_chest = random_3bit % num_chests;
        
        // Check if player won
        let player_won = player_choice.choice == winning_chest;
        
        // Return plaintext result - both values are revealed publicly
        // This proves fairness: winning chest was determined after player committed
        (player_won.reveal(), winning_chest.reveal())
    }
}
