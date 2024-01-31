import { createMarketWithLoan } from './setup_utils';
import { updateReserve } from './setup_operations';
import { fuzzyEq, newFlat, sleep } from '../src';
import { expect } from 'chai';
import { INITIAL_COLLATERAL_RATE } from '../src/utils';
import { BN } from '@coral-xyz/anchor';
import { ReserveConfig } from '../src/idl_codegen/types';
import Decimal from 'decimal.js';

describe('reserve', function () {
  it('retrieve_a_fresh_reserve', async function () {
    const { kaminoMarket } = await createMarketWithLoan(new BN(0), new BN(0));
    await kaminoMarket.loadReserves();
    const fetchedReserve = kaminoMarket.getReserveBySymbol('USDH')!;

    expect(fetchedReserve).not.eq(undefined);
    expect(fetchedReserve.symbol).eq('USDH');
    expect(fetchedReserve.getTotalSupply().toString()).eq('0');
    expect(fetchedReserve.getBorrowedAmount().toString()).eq('0');
    expect(fetchedReserve.getCollateralExchangeRate().toString()).eq(INITIAL_COLLATERAL_RATE.toString());
    expect(fetchedReserve.depositLimitCrossed()).eq(false);
    expect(fetchedReserve.borrowLimitCrossed()).eq(false);
  });

  it('retrieve_an_active_reserve', async function () {
    const { kaminoMarket } = await createMarketWithLoan(new BN(1000_000000), new BN(100_000000));
    const fetchedReserve = kaminoMarket.getReserveBySymbol('USDH')!;

    expect(fetchedReserve).not.eq(undefined);
    fuzzyEq(fetchedReserve.getTotalSupply(), new BN(1000_000000).toString());
    fuzzyEq(fetchedReserve.getBorrowedAmount(), new BN(100_000000).toString());
    fuzzyEq(fetchedReserve.getCollateralExchangeRate(), INITIAL_COLLATERAL_RATE.toString());
    fuzzyEq(
      fetchedReserve.getDepositTvl(),
      new Decimal(1000).mul(new Decimal(fetchedReserve.getReserveMarketPrice())).toString()
    );
    fuzzyEq(
      fetchedReserve.getBorrowTvl(),
      new Decimal(100).mul(new Decimal(fetchedReserve.getReserveMarketPrice())).toString()
    );
  });

  it('update_reserve_borrow_curve', async function () {
    const { kaminoMarket, env } = await createMarketWithLoan(new BN(1000_000000), new BN(100_000000));
    const fetchedReserve = kaminoMarket.getReserveBySymbol('USDH')!;
    const newCurve = newFlat(25);
    await updateReserve(
      env,
      fetchedReserve.address,
      new ReserveConfig({
        ...fetchedReserve.state.config,
        borrowRateCurve: newCurve,
      })
    );
    await sleep(2000);
    await kaminoMarket.refreshAll();
    const updatedReserve = kaminoMarket.getReserveBySymbol('USDH')!;

    expect(updatedReserve.state.config.borrowRateCurve).deep.eq(newCurve);
  });

  it('test_reserve_limit_crossed_functions', async function () {
    const { env, kaminoMarket } = await createMarketWithLoan(new BN(1000_000000), new BN(100_000000));
    const fetchedReserve = kaminoMarket.getReserveBySymbol('USDH')!;
    expect(fetchedReserve.depositLimitCrossed()).eq(false);
    expect(fetchedReserve.borrowLimitCrossed()).eq(false);

    // update reserve limits
    const config = new ReserveConfig({
      ...fetchedReserve.state.config,
      depositLimit: new BN(500_000000),
      borrowLimit: new BN(50_000000),
    });
    await updateReserve(env, fetchedReserve.address, config);
    await sleep(2000);
    await kaminoMarket.refreshAll();
    const updatedReserve = kaminoMarket.getReserveBySymbol('USDH')!;

    expect(updatedReserve.depositLimitCrossed()).eq(true);
    expect(updatedReserve.borrowLimitCrossed()).eq(true);
  });
});
