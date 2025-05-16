use anchor_lang::prelude::*;

declare_id!("BddqQ2dwbQLtbcgEg1v9QAFejU7vnEAVHcvutCd98eBT");

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
}

#[derive(Accounts)]
pub struct RegisterGpu<'info> {
    #[account(init, payer = owner, space = 8 + 32 + 4 + 200 + 1)]
    pub gpu_account: Account<'info, GpuAccount>,

    #[account(mut)]
    pub owner: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[account]
pub struct GpuAccount {
    pub owner: Pubkey,
    pub specs: String,
    pub active: bool,
}
