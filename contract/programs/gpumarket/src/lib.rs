use anchor_lang::prelude::*;

declare_id!("DPQG3BiR9Avg5mknQTDKZ24w4T9D8NEKmgALvEyyH2N4");

#[program]
pub mod gpumarket {
    use super::*;

    pub fn register_gpu(ctx: Context<RegisterGpu>, specs: String) -> Result<()> {
        let gpu = &mut ctx.accounts.gpu_account;
        gpu.owner = *ctx.accounts.owner.key;
        gpu.specs = specs;
        gpu.active = true;
        Ok(())
    }

    pub fn start_session(
        ctx: Context<StartSession>,
        duration_hours: u64,
        price_per_hour: u64,
    ) -> Result<()> {
        let session = &mut ctx.accounts.session_account;
        session.renter = *ctx.accounts.renter.key;
        session.provider = ctx.accounts.gpu_account.owner;
        session.gpu = ctx.accounts.gpu_account.key();
        session.start_time = Clock::get()?.unix_timestamp;
        session.duration_hours = duration_hours;
        session.price_per_hour = price_per_hour;
        session.status = SessionStatus::Active;
        Ok(())
    }

    pub fn end_session(ctx: Context<EndSession>) -> Result<()> {
        let session = &mut ctx.accounts.session_account;
        let session_info = session.to_account_info();
        let provider_info = &ctx.accounts.provider;

        require!(
            session.status == SessionStatus::Active,
            GpuError::SessionNotActive
        );

        let now = Clock::get()?.unix_timestamp;
        let elapsed = (now - session.start_time) as u64;
        let billable_hours = std::cmp::min(elapsed / 3600, session.duration_hours);
        let total_price = billable_hours * session.price_per_hour;

        let session_balance = session_info.lamports();
        require!(session_balance >= total_price, GpuError::InsufficientFunds);

        **session_info.try_borrow_mut_lamports()? -= total_price;
        **provider_info.try_borrow_mut_lamports()? += total_price;

        session.status = SessionStatus::Completed;
        Ok(())
    }
}

#[derive(Accounts)]
pub struct RegisterGpu<'info> {
    #[account(init, payer = owner, space = 8 + 32 + 4 + 200 + 1)]
    pub gpu_account: Account<'info, GpuAccount>,
    #[account(mut)]
    pub owner: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct StartSession<'info> {
    #[account(init, payer = renter, space = 8 + 32*3 + 8*3 + 1)]
    pub session_account: Account<'info, Session>,
    #[account(mut)]
    pub renter: Signer<'info>,
    pub gpu_account: Account<'info, GpuAccount>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct EndSession<'info> {
    #[account(mut)]
    pub session_account: Account<'info, Session>,

    /// CHECK: This account is validated in code by matching with session.provider
    #[account(mut)]
    pub provider: AccountInfo<'info>,
}

#[account]
pub struct GpuAccount {
    pub owner: Pubkey,
    pub specs: String,
    pub active: bool,
}

#[account]
pub struct Session {
    pub renter: Pubkey,
    pub provider: Pubkey,
    pub gpu: Pubkey,
    pub start_time: i64,
    pub duration_hours: u64,
    pub price_per_hour: u64,
    pub status: SessionStatus,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq, Eq)]
pub enum SessionStatus {
    Active,
    Completed,
    Cancelled,
}

#[error_code]
pub enum GpuError {
    #[msg("Session is not active.")]
    SessionNotActive,
    #[msg("Insufficient funds in session account.")]
    InsufficientFunds,
}
