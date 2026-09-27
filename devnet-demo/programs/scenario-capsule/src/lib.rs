use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::{self, Mint, Token, TokenAccount, TransferChecked};

pub mod state;
use state::*;

declare_id!("GGwyWv1goVjyTiH9tQ72uXrn2voF56eZESnM4rEwrY98");

#[program]
pub mod scenario_capsule {
    use super::*;

    pub fn initialize_session(ctx: Context<InitializeSession>, session_id: [u8; 32], ttl_seconds: i64) -> Result<()> {
        require!(validate_ttl(ttl_seconds), DemoError::InvalidTtl);
        let now = Clock::get()?.unix_timestamp;
        let session = &mut ctx.accounts.session;
        session.authority = ctx.accounts.authority.key();
        session.session_id = session_id;
        session.flags = 0;
        session.sequence = 0;
        session.created_at = now;
        session.expires_at = now.checked_add(ttl_seconds).ok_or(DemoError::Overflow)?;
        session.last_updated_at = now;
        session.bump = ctx.bumps.session;
        emit!(SessionInitialized { session: session.key(), authority: session.authority, session_id, expires_at: session.expires_at });
        Ok(())
    }

    pub fn deposit_position(ctx: Context<DepositPosition>, amount: u64) -> Result<()> {
        require!(amount > 0, DemoError::InvalidAmount);
        token::transfer_checked(ctx.accounts.deposit_transfer(), amount, ctx.accounts.mint.decimals)?;
        let position = &mut ctx.accounts.position;
        position.session = ctx.accounts.session.key();
        position.owner = ctx.accounts.owner.key();
        position.mint = ctx.accounts.mint.key();
        position.amount = amount;
        position.protected = false;
        position.evacuated = false;
        position.bump = ctx.bumps.position;
        emit!(PositionDeposited { position: position.key(), session: position.session, owner: position.owner, mint: position.mint, amount });
        Ok(())
    }

    pub fn arm_protection(ctx: Context<ArmProtection>) -> Result<()> {
        let (fee, protected_principal) = protection_terms(ctx.accounts.position.amount).ok_or(DemoError::Overflow)?;
        token::transfer_checked(ctx.accounts.fee_transfer(), fee, ctx.accounts.mint.decimals)?;
        let position = &mut ctx.accounts.position;
        position.amount = protected_principal;
        require!(!position.evacuated, DemoError::AlreadyEvacuated);
        position.protected = true;
        emit!(ProtectionArmed { position: position.key(), owner: position.owner, amount: position.amount, fee });
        Ok(())
    }

    pub fn trigger_scenarios(ctx: Context<MutateSession>, flags: u16) -> Result<()> {
        require!(validate_flags(flags), DemoError::InvalidScenarioFlags);
        let now = Clock::get()?.unix_timestamp;
        let session = &mut ctx.accounts.session;
        require!(now < session.expires_at, DemoError::SessionExpired);
        session.flags = flags;
        session.sequence = session.sequence.checked_add(1).ok_or(DemoError::Overflow)?;
        session.last_updated_at = now;
        emit!(ScenariosTriggered { session: session.key(), sequence: session.sequence, flags, expires_at: session.expires_at });
        Ok(())
    }

    pub fn evacuate(ctx: Context<Evacuate>) -> Result<()> {
        let position = &ctx.accounts.position;
        require!(can_evacuate(ctx.accounts.session.flags, position.protected, position.evacuated), DemoError::EvacuationUnavailable);
        let returned = position.amount;
        let session_key = ctx.accounts.session.key();
        let owner_key = ctx.accounts.owner.key();
        let bump = [position.bump];
        let signer_seeds: &[&[u8]] = &[b"position", session_key.as_ref(), owner_key.as_ref(), &bump];
        token::transfer_checked(ctx.accounts.evacuation_transfer().with_signer(&[signer_seeds]), returned, ctx.accounts.mint.decimals)?;
        ctx.accounts.position.evacuated = true;
        emit!(PositionEvacuated { position: ctx.accounts.position.key(), owner: owner_key, returned });
        Ok(())
    }

    pub fn reset_session(ctx: Context<MutateSession>) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let session = &mut ctx.accounts.session;
        session.flags = 0;
        session.sequence = session.sequence.checked_add(1).ok_or(DemoError::Overflow)?;
        session.last_updated_at = now;
        emit!(SessionReset { session: session.key(), sequence: session.sequence, reset_at: now });
        Ok(())
    }
}

#[derive(Accounts)]
#[instruction(session_id: [u8; 32])]
pub struct InitializeSession<'info> {
    #[account(init, payer = authority, space = 8 + DemoSession::INIT_SPACE, seeds = [b"demo-session", authority.key().as_ref(), session_id.as_ref()], bump)]
    pub session: Account<'info, DemoSession>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct DepositPosition<'info> {
    pub session: Account<'info, DemoSession>,
    #[account(init, payer = owner, space = 8 + DemoPosition::INIT_SPACE, seeds = [b"position", session.key().as_ref(), owner.key().as_ref()], bump)]
    pub position: Account<'info, DemoPosition>,
    #[account(mut)]
    pub owner: Signer<'info>,
    pub mint: Account<'info, Mint>,
    #[account(mut, token::mint = mint, token::authority = owner)]
    pub owner_token: Account<'info, TokenAccount>,
    #[account(init, payer = owner, associated_token::mint = mint, associated_token::authority = position)]
    pub vault_token: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

impl<'info> DepositPosition<'info> {
    fn deposit_transfer(&self) -> CpiContext<'_, '_, '_, 'info, TransferChecked<'info>> {
        CpiContext::new(self.token_program.to_account_info(), TransferChecked { from: self.owner_token.to_account_info(), mint: self.mint.to_account_info(), to: self.vault_token.to_account_info(), authority: self.owner.to_account_info() })
    }
}

#[derive(Accounts)]
pub struct ArmProtection<'info> {
    pub session: Account<'info, DemoSession>,
    #[account(mut, has_one = session, has_one = owner)]
    pub position: Account<'info, DemoPosition>,
    pub owner: Signer<'info>,
    pub mint: Account<'info, Mint>,
    #[account(mut, token::mint = mint, token::authority = owner)]
    pub owner_token: Account<'info, TokenAccount>,
    #[account(mut, token::mint = mint, token::authority = session.authority)]
    pub treasury_token: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

impl<'info> ArmProtection<'info> {
    fn fee_transfer(&self) -> CpiContext<'_, '_, '_, 'info, TransferChecked<'info>> {
        CpiContext::new(self.token_program.to_account_info(), TransferChecked { from: self.owner_token.to_account_info(), mint: self.mint.to_account_info(), to: self.treasury_token.to_account_info(), authority: self.owner.to_account_info() })
    }
}

#[derive(Accounts)]
pub struct MutateSession<'info> {
    #[account(mut, has_one = authority)]
    pub session: Account<'info, DemoSession>,
    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct Evacuate<'info> {
    pub session: Account<'info, DemoSession>,
    #[account(mut, has_one = session, has_one = owner, has_one = mint, seeds = [b"position", session.key().as_ref(), owner.key().as_ref()], bump = position.bump)]
    pub position: Account<'info, DemoPosition>,
    pub owner: Signer<'info>,
    pub mint: Account<'info, Mint>,
    #[account(mut, token::mint = mint, token::authority = position)]
    pub vault_token: Account<'info, TokenAccount>,
    #[account(mut, token::mint = mint, token::authority = owner)]
    pub owner_token: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

impl<'info> Evacuate<'info> {
    fn transfer(&self, to: AccountInfo<'info>) -> CpiContext<'_, '_, '_, 'info, TransferChecked<'info>> {
        CpiContext::new(self.token_program.to_account_info(), TransferChecked { from: self.vault_token.to_account_info(), mint: self.mint.to_account_info(), to, authority: self.position.to_account_info() })
    }
    fn evacuation_transfer(&self) -> CpiContext<'_, '_, '_, 'info, TransferChecked<'info>> { self.transfer(self.owner_token.to_account_info()) }
}

#[account]
#[derive(InitSpace)]
pub struct DemoSession { pub authority: Pubkey, pub session_id: [u8; 32], pub flags: u16, pub sequence: u64, pub created_at: i64, pub expires_at: i64, pub last_updated_at: i64, pub bump: u8 }
impl DemoSession { pub fn effective_flags(&self, now: i64) -> u16 { effective_flags(self.flags, now, self.expires_at) } }

#[account]
#[derive(InitSpace)]
pub struct DemoPosition { pub session: Pubkey, pub owner: Pubkey, pub mint: Pubkey, pub amount: u64, pub protected: bool, pub evacuated: bool, pub bump: u8 }

#[event]
pub struct SessionInitialized { pub session: Pubkey, pub authority: Pubkey, pub session_id: [u8; 32], pub expires_at: i64 }
#[event]
pub struct PositionDeposited { pub position: Pubkey, pub session: Pubkey, pub owner: Pubkey, pub mint: Pubkey, pub amount: u64 }
#[event]
pub struct ProtectionArmed { pub position: Pubkey, pub owner: Pubkey, pub amount: u64, pub fee: u64 }
#[event]
pub struct ScenariosTriggered { pub session: Pubkey, pub sequence: u64, pub flags: u16, pub expires_at: i64 }
#[event]
pub struct PositionEvacuated { pub position: Pubkey, pub owner: Pubkey, pub returned: u64 }
#[event]
pub struct SessionReset { pub session: Pubkey, pub sequence: u64, pub reset_at: i64 }

#[error_code]
pub enum DemoError {
    #[msg("TTL must be between 30 and 300 seconds")] InvalidTtl,
    #[msg("Scenario flags must contain only supported nonzero bits")] InvalidScenarioFlags,
    #[msg("Session has expired; create a new capsule")] SessionExpired,
    #[msg("Deposit amount must be greater than zero")] InvalidAmount,
    #[msg("Position was already evacuated")] AlreadyEvacuated,
    #[msg("Evacuation requires an armed, unused position and an active breach")] EvacuationUnavailable,
    #[msg("Arithmetic overflow")] Overflow,
}
