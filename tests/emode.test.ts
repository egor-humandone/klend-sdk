// Tests
// - [ ] deposit and switch elevation group back and forth - with no debt, with debt
// - [ ] borrow and switch elevation group back and forth - with no debt, with debt
// - [ ] test isLoanEligibleForElevationGroup()
// - [ ] test getElevationGroupsForObligation()
// - [ ] test getBorrowCapForReserve() -> BorrowCapsAndCounters is correctly calculated
// - [ ] test getLiquidityAvailableForDebtReserveGivenCaps()
// - [ ] test getBorrowPower()
// - [ ] test getMaxBorrowAmountV2()
// - TODO: remove all the toString()
import { assert } from 'chai';
import {
  createMarket,
  updateMarketElevationGroup,
  updateReserveBorrowLimit,
  updateReserveBorrowLimitOutsideEmode,
  updateReserveBorrowLimitsAgainstCollInElevationGroup,
  updateReserveElevationGroups,
  updateReserveUtilizationCap,
} from './setup_operations';
import {
  addReserveToMarket,
  balances,
  deposit,
  initEnv,
  makeElevationGroupConfig,
  newUser,
  sendTransactionsFromAction,
} from './setup_utils';
import { createScopeFeed } from './kamino/scope';
import { sleep } from '@kamino-finance/kliquidity-sdk';
import { DEFAULT_RECENT_SLOT_DURATION_MS, KaminoAction, KaminoMarket, PROGRAM_ID, VanillaObligation } from '../src';
import Decimal from 'decimal.js';

describe('isolated_and_cross_modes', () => {
  it('switch elevation group back and forth between 0 (default) and elevated one', async () => {
    const env = await initEnv('localnet');
    const [, market] = await createMarket(env);
    const kaminoMarket = (await KaminoMarket.load(
      env.connection,
      market.publicKey,
      DEFAULT_RECENT_SLOT_DURATION_MS,
      PROGRAM_ID,
      true
    ))!;

    await createScopeFeed(env, kaminoMarket.scope);
    await sleep(2000);

    // Create group between SOL and JITOSOL, with SOL debt
    // Create group between SOL and PyUSD, with PyUSD debt
    // Create group between USDC and PyUSD, with USDC debt

    const res = await Promise.all([
      addReserveToMarket(env, market, 'SOL'),
      addReserveToMarket(env, market, 'JITOSOL'),
      addReserveToMarket(env, market, 'USDC'),
      addReserveToMarket(env, market, 'PYUSD'),
    ]);

    const { reserve: solReservePk } = res[0];
    const { reserve: jitosolReservePk } = res[1];
    const { reserve: usdcReservePk } = res[2];
    const { reserve: pyusdReservePk } = res[3];

    const defaultElevationGroupNo = 0;
    const jitosolSolGroupNo = 1;
    const solPyusdGroupNo = 2;
    const pyusdUsdcGroupNo = 3;
    const jitosolSolGroup = makeElevationGroupConfig(solReservePk, jitosolSolGroupNo); // JITOSOL collateral, SOL debt
    const solPyusdGroup = makeElevationGroupConfig(pyusdReservePk, solPyusdGroupNo); // SOL collateral, PyUSD debt
    const pyusdUsdcGroup = makeElevationGroupConfig(usdcReservePk, pyusdUsdcGroupNo); // PyUSD collateral, USDC debt

    console.log('solReservePk', solReservePk.toString());
    console.log('usdcReservePk', usdcReservePk.toString());
    console.log('jitosolReservePk', jitosolReservePk.toString());
    console.log('pyusdReservePk', pyusdReservePk.toString());

    await Promise.all([
      updateMarketElevationGroup(env, market.publicKey, solReservePk, jitosolSolGroup),
      updateMarketElevationGroup(env, market.publicKey, pyusdReservePk, solPyusdGroup),
      updateMarketElevationGroup(env, market.publicKey, usdcReservePk, pyusdUsdcGroup),
    ]);

    await Promise.all([
      updateReserveElevationGroups(env, solReservePk, [jitosolSolGroupNo, solPyusdGroupNo]),
      updateReserveElevationGroups(env, jitosolReservePk, [jitosolSolGroupNo]),
      updateReserveElevationGroups(env, usdcReservePk, [pyusdUsdcGroupNo]),
      updateReserveElevationGroups(env, pyusdReservePk, [solPyusdGroupNo, pyusdUsdcGroupNo]),
    ]);

    //

    await kaminoMarket.reload();

    const user = await newUser(env, kaminoMarket, [
      ['SOL', new Decimal(10)],
      ['JITOSOL', new Decimal(10)],
      ['USDC', new Decimal(10)],
      ['PYUSD', new Decimal(10)],
    ]);

    await sleep(2000);
    const userBalances = await balances(env, user, kaminoMarket, ['SOL', 'JITOSOL', 'USDC', 'PYUSD']);
    console.log('userBalances', userBalances);

    await sleep(2000);
    await deposit(env, kaminoMarket, user, 'SOL', new Decimal(1), new VanillaObligation(PROGRAM_ID));

    let obligation = (await kaminoMarket.getObligationByWallet(user.publicKey, new VanillaObligation(PROGRAM_ID)))!;
    console.log('Obligation', 'Elevation Group', obligation?.state.elevationGroup);
    assert.equal(obligation.state.elevationGroup, defaultElevationGroupNo);

    // Try to switch to the elevation group 2
    const switchElevationGroupAction = await KaminoAction.buildRequestElevationGroupTxns(
      kaminoMarket,
      user.publicKey,
      obligation,
      solPyusdGroupNo
    );

    const sig = await sendTransactionsFromAction(env, switchElevationGroupAction, user);
    console.log('Switch Elevation Group', sig);

    obligation = (await kaminoMarket.getObligationByWallet(user.publicKey, new VanillaObligation(PROGRAM_ID)))!;
    console.log('Obligation', 'Elevation Group', obligation.state.elevationGroup);
    assert.equal(obligation.state.elevationGroup, solPyusdGroupNo);

    // Try to switch back to the elevation group 0
    const switchBackElevationGroupAction = await KaminoAction.buildRequestElevationGroupTxns(
      kaminoMarket,
      user.publicKey,
      obligation,
      defaultElevationGroupNo
    );

    const sig2 = await sendTransactionsFromAction(env, switchBackElevationGroupAction, user);
    console.log('Switch Back Elevation Group', sig2);

    obligation = (await kaminoMarket.getObligationByWallet(user.publicKey, new VanillaObligation(PROGRAM_ID)))!;
    console.log('Obligation', 'Elevation Group', obligation.state.elevationGroup);
    assert.equal(obligation.state.elevationGroup, defaultElevationGroupNo);
  });

  it('elevation group utils', async () => {
    const env = await initEnv('localnet');
    const [, market] = await createMarket(env);
    const kaminoMarket = (await KaminoMarket.load(
      env.connection,
      market.publicKey,
      DEFAULT_RECENT_SLOT_DURATION_MS,
      PROGRAM_ID,
      true
    ))!;

    const initAllElevationGroups = await kaminoMarket.getMarketElevationGroupDescriptions();
    assert.equal(initAllElevationGroups.length, 0);

    await createScopeFeed(env, kaminoMarket.scope);
    await sleep(2000);

    // Create group between SOL and JITOSOL, with SOL debt
    // Create group between SOL and PyUSD, with PyUSD debt
    // Create group between USDC and PyUSD, with USDC debt

    const res = await Promise.all([
      addReserveToMarket(env, market, 'SOL'),
      addReserveToMarket(env, market, 'JITOSOL'),
      addReserveToMarket(env, market, 'USDC'),
      addReserveToMarket(env, market, 'PYUSD'),
    ]);

    const { mint: solMint, reserve: solReservePk } = res[0];
    const { mint: jitosolMint, reserve: jitosolReservePk } = res[1];
    const { mint: usdcMint, reserve: usdcReservePk } = res[2];
    const { mint: pyusdMint, reserve: pyusdReservePk } = res[3];

    const jitosolSolGroupNo = 1;
    const solPyusdGroupNo = 2;
    const pyusdUsdcGroupNo = 3;
    const jitosolSolGroup = makeElevationGroupConfig(solReservePk, jitosolSolGroupNo); // SOL debt, JITOSOL collateral
    const solPyusdGroup = makeElevationGroupConfig(pyusdReservePk, solPyusdGroupNo); // PyUSD debt, SOL collateral
    const pyusdUsdcGroup = makeElevationGroupConfig(usdcReservePk, pyusdUsdcGroupNo); // USDC debt, PyUSD collateral

    console.log('solReservePk', solReservePk.toString());
    console.log('usdcReservePk', usdcReservePk.toString());
    console.log('jitosolReservePk', jitosolReservePk.toString());
    console.log('pyusdReservePk', pyusdReservePk.toString());

    await Promise.all([
      updateMarketElevationGroup(env, market.publicKey, solReservePk, jitosolSolGroup),
      updateMarketElevationGroup(env, market.publicKey, pyusdReservePk, solPyusdGroup),
      updateMarketElevationGroup(env, market.publicKey, usdcReservePk, pyusdUsdcGroup),
    ]);

    await Promise.all([
      updateReserveElevationGroups(env, solReservePk, [jitosolSolGroupNo, solPyusdGroupNo]),
      updateReserveElevationGroups(env, jitosolReservePk, [jitosolSolGroupNo]),
      updateReserveElevationGroups(env, usdcReservePk, [pyusdUsdcGroupNo]),
      updateReserveElevationGroups(env, pyusdReservePk, [solPyusdGroupNo, pyusdUsdcGroupNo]),
    ]);

    //

    await sleep(2000);
    await kaminoMarket.reload();

    const allElevationGroups = await kaminoMarket.getMarketElevationGroupDescriptions();

    const numElevationGroups = 3;
    assert.equal(allElevationGroups.length, numElevationGroups);

    const expectedElevationGroups = [
      {
        collateralReserves: [jitosolReservePk.toString()],
        collateralLiquidityMints: [jitosolMint.toString()],
        debtReserve: solReservePk.toString(),
        debtLiquidityMint: solMint.toString(),
        elevationGroup: jitosolSolGroupNo,
      },
      {
        collateralReserves: [solReservePk.toString()],
        collateralLiquidityMints: [solMint.toString()],
        debtReserve: pyusdReservePk.toString(),
        debtLiquidityMint: pyusdMint.toString(),
        elevationGroup: solPyusdGroupNo,
      },
      {
        collateralReserves: [pyusdReservePk.toString()],
        collateralLiquidityMints: [pyusdMint.toString()],
        debtReserve: usdcReservePk.toString(),
        debtLiquidityMint: usdcMint.toString(),
        elevationGroup: pyusdUsdcGroupNo,
      },
    ];

    for (let i = 0; i < numElevationGroups; i++) {
      assert.deepEqual(allElevationGroups[i], expectedElevationGroups[i]);
    }

    const solPyusd = kaminoMarket.getElevationGroupsForMintsCombination([solMint], pyusdMint);
    assert.equal(solPyusd.length, 1);
    assert.equal(solPyusd[0].elevationGroup, solPyusdGroupNo);

    const jitosolSol = kaminoMarket.getElevationGroupsForMintsCombination([jitosolMint], solMint);
    assert.equal(jitosolSol.length, 1);
    assert.equal(jitosolSol[0].elevationGroup, jitosolSolGroupNo);

    const pyusdUsdc = kaminoMarket.getElevationGroupsForMintsCombination([pyusdMint], usdcMint);
    assert.equal(pyusdUsdc.length, 1);
    assert.equal(pyusdUsdc[0].elevationGroup, pyusdUsdcGroupNo);

    const usdcPyusd = kaminoMarket.getElevationGroupsForMintsCombination([usdcMint], pyusdMint);
    assert.equal(usdcPyusd.length, 0);

    const jitosolPyUsd = kaminoMarket.getElevationGroupsForMintsCombination([jitosolMint], pyusdMint);
    assert.equal(jitosolPyUsd.length, 0);

    const jitosolUsdc = kaminoMarket.getElevationGroupsForMintsCombination([jitosolMint], usdcMint);
    assert.equal(jitosolUsdc.length, 0);

    const jitosolDebtSolColl = kaminoMarket.getElevationGroupsForMintsCombination([solMint], jitosolMint);
    assert.equal(jitosolDebtSolColl.length, 0);

    const solCollateralGroups = kaminoMarket.getElevationGroupsForMintsCombination([solMint], undefined);
    assert.equal(solCollateralGroups.length, 1);
  });

  it('loan elevation group eligibility', async () => {
    const env = await initEnv('localnet');
    const [, market] = await createMarket(env);
    const kaminoMarket = (await KaminoMarket.load(
      env.connection,
      market.publicKey,
      DEFAULT_RECENT_SLOT_DURATION_MS,
      PROGRAM_ID,
      true
    ))!;

    await createScopeFeed(env, kaminoMarket.scope);
    await sleep(2000);

    // Create group between SOL and JITOSOL, with SOL debt
    // Create group between SOL and PyUSD, with PyUSD debt
    // Create group between USDC and PyUSD, with USDC debt

    const res = await Promise.all([
      addReserveToMarket(env, market, 'SOL'),
      addReserveToMarket(env, market, 'JITOSOL'),
      addReserveToMarket(env, market, 'USDC'),
      addReserveToMarket(env, market, 'PYUSD'),
    ]);

    const { reserve: solReservePk } = res[0];
    const { reserve: jitosolReservePk } = res[1];
    const { reserve: usdcReservePk } = res[2];
    const { reserve: pyusdReservePk } = res[3];

    const defaultElevationGroupNo = 0;
    const jitosolSolGroupNo = 1;
    const solPyusdGroupNo = 2;
    const pyusdUsdcGroupNo = 3;
    const solUsdcGroupNo = 4;

    const jitosolSolGroup = makeElevationGroupConfig(solReservePk, jitosolSolGroupNo); // JITOSOL collateral, SOL debt,
    const solPyusdGroup = makeElevationGroupConfig(pyusdReservePk, solPyusdGroupNo); // SOL collateral, PyUSD debt,
    const pyusdUsdcGroup = makeElevationGroupConfig(usdcReservePk, pyusdUsdcGroupNo); // PyUSD collateral, USDC debt,
    const solUsdcGroup = makeElevationGroupConfig(usdcReservePk, solUsdcGroupNo); // SOL collateral, USDC debt,

    console.log('solReservePk', solReservePk.toString());
    console.log('usdcReservePk', usdcReservePk.toString());
    console.log('jitosolReservePk', jitosolReservePk.toString());
    console.log('pyusdReservePk', pyusdReservePk.toString());

    await Promise.all([
      updateMarketElevationGroup(env, market.publicKey, solReservePk, jitosolSolGroup),
      updateMarketElevationGroup(env, market.publicKey, pyusdReservePk, solPyusdGroup),
      updateMarketElevationGroup(env, market.publicKey, usdcReservePk, pyusdUsdcGroup),
      updateMarketElevationGroup(env, market.publicKey, usdcReservePk, solUsdcGroup),
    ]);

    await Promise.all([
      updateReserveElevationGroups(env, solReservePk, [jitosolSolGroupNo, solPyusdGroupNo, solUsdcGroupNo]),
      updateReserveElevationGroups(env, jitosolReservePk, [jitosolSolGroupNo]),
      updateReserveElevationGroups(env, usdcReservePk, [pyusdUsdcGroupNo, solUsdcGroupNo]),
      updateReserveElevationGroups(env, pyusdReservePk, [solPyusdGroupNo, pyusdUsdcGroupNo]),
    ]);

    //

    await sleep(2000);
    await kaminoMarket.reload();

    const user = await newUser(env, kaminoMarket, [
      ['SOL', new Decimal(10)],
      ['JITOSOL', new Decimal(10)],
      ['USDC', new Decimal(10)],
      ['PYUSD', new Decimal(10)],
    ]);

    await sleep(2000);

    await deposit(env, kaminoMarket, user, 'SOL', new Decimal(1), new VanillaObligation(PROGRAM_ID));
    await sleep(2000);

    const slot = await env.connection.getSlot();

    const obligation = (await kaminoMarket.getObligationByWallet(user.publicKey, new VanillaObligation(PROGRAM_ID)))!;

    const eligibleGroups = await obligation.getElevationGroupsForObligation(kaminoMarket);
    assert.equal(eligibleGroups.length, 2);
    console.log('Eligible Groups', eligibleGroups);

    assert.equal(obligation.isLoanEligibleForElevationGroup(kaminoMarket, slot, jitosolSolGroupNo), false);
    assert.equal(obligation.isLoanEligibleForElevationGroup(kaminoMarket, slot, solPyusdGroupNo), true);
    assert.equal(obligation.isLoanEligibleForElevationGroup(kaminoMarket, slot, pyusdUsdcGroupNo), false);
    assert.equal(obligation.isLoanEligibleForElevationGroup(kaminoMarket, slot, solUsdcGroupNo), true);
    assert.equal(obligation.isLoanEligibleForElevationGroup(kaminoMarket, slot, defaultElevationGroupNo), true);
  });

  it('borrow caps', async () => {
    const env = await initEnv('localnet');
    const [, market] = await createMarket(env);
    const kaminoMarket = (await KaminoMarket.load(
      env.connection,
      market.publicKey,
      DEFAULT_RECENT_SLOT_DURATION_MS,
      PROGRAM_ID,
      true
    ))!;

    await createScopeFeed(env, kaminoMarket.scope);
    await sleep(2000);

    // Create group between SOL and JITOSOL, with SOL debt
    // Create group between SOL and PyUSD, with PyUSD debt
    // Create group between USDC and PyUSD, with USDC debt

    const res = await Promise.all([
      addReserveToMarket(env, market, 'SOL'),
      addReserveToMarket(env, market, 'JITOSOL'),
      addReserveToMarket(env, market, 'USDC'),
      addReserveToMarket(env, market, 'PYUSD'),
    ]);

    const { reserve: solReservePk } = res[0];
    const { reserve: jitosolReservePk } = res[1];
    const { reserve: usdcReservePk } = res[2];
    const { reserve: pyusdReservePk } = res[3];

    // const defaultElevationGroupNo = 0;
    const jitosolSolGroupNo = 1;
    const solPyusdGroupNo = 2;
    const pyusdUsdcGroupNo = 3;
    const solUsdcGroupNo = 4;

    const jitosolSolGroup = makeElevationGroupConfig(solReservePk, jitosolSolGroupNo); // JITOSOL collateral, SOL debt,
    const solPyusdGroup = makeElevationGroupConfig(pyusdReservePk, solPyusdGroupNo); // SOL collateral, PyUSD debt,
    const pyusdUsdcGroup = makeElevationGroupConfig(usdcReservePk, pyusdUsdcGroupNo); // PyUSD collateral, USDC debt,
    const solUsdcGroup = makeElevationGroupConfig(usdcReservePk, solUsdcGroupNo); // SOL collateral, USDC debt,

    console.log('solReservePk', solReservePk.toString());
    console.log('usdcReservePk', usdcReservePk.toString());
    console.log('jitosolReservePk', jitosolReservePk.toString());
    console.log('pyusdReservePk', pyusdReservePk.toString());

    await Promise.all([
      updateMarketElevationGroup(env, market.publicKey, solReservePk, jitosolSolGroup),
      updateMarketElevationGroup(env, market.publicKey, pyusdReservePk, solPyusdGroup),
      updateMarketElevationGroup(env, market.publicKey, usdcReservePk, pyusdUsdcGroup),
      updateMarketElevationGroup(env, market.publicKey, usdcReservePk, solUsdcGroup),
    ]);

    await Promise.all([
      updateReserveElevationGroups(env, solReservePk, [jitosolSolGroupNo, solPyusdGroupNo, solUsdcGroupNo]),
      updateReserveElevationGroups(env, jitosolReservePk, [jitosolSolGroupNo]),
      updateReserveElevationGroups(env, usdcReservePk, [pyusdUsdcGroupNo, solUsdcGroupNo]),
      updateReserveElevationGroups(env, pyusdReservePk, [solPyusdGroupNo, pyusdUsdcGroupNo]),
    ]);

    await updateReserveBorrowLimit(env, kaminoMarket, solReservePk, 2000);
    await updateReserveBorrowLimitOutsideEmode(env, kaminoMarket, solReservePk, 1500);
    await updateReserveUtilizationCap(env, kaminoMarket, solReservePk, 80);
    await updateReserveBorrowLimitsAgainstCollInElevationGroup(env, kaminoMarket, jitosolReservePk, [500]);

    await sleep(2000);
    await kaminoMarket.reload();

    const user = await newUser(env, kaminoMarket, [
      ['SOL', new Decimal(10)],
      ['JITOSOL', new Decimal(10)],
      ['USDC', new Decimal(10)],
      ['PYUSD', new Decimal(10)],
    ]);

    await sleep(2000);

    await deposit(env, kaminoMarket, user, 'SOL', new Decimal(1), new VanillaObligation(PROGRAM_ID));
    await sleep(2000);

    const solReserve = kaminoMarket.getReserveByAddress(solReservePk);
    const borrowCaps = await solReserve!.getBorrowCapForReserve(kaminoMarket);

    console.log('Borrow Caps', borrowCaps);
  });
});
