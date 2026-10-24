// Handler event FotokopiKilat. Aturan meniru contract: contract tetap sumber kebenaran,
// indexer hanya merangkum (snapshot, riwayat, leaderboard omzet per sesi).
import { indexer, type EvmOnEventContext, type Order, type Pelanggan, type Statistik } from "envio";

const NOL = 0n;
const ALASAN = ["Antre", "Kerja"] as const;

type Ctx = EvmOnEventContext;

const statistik = (context: Ctx): Promise<Statistik> =>
  context.Statistik.getOrCreate({
    id: "global", sesiAktif: 0, feeRelay: NOL, order: 0, selesai: 0, expired: 0, sengketa: 0, relayed: 0,
    volume: NOL, payout: NOL, refund: NOL, topUp: NOL, platformFeeBps: 0, pendapatanFee: NOL, pendapatanPro: NOL,
  });

const pelanggan = (context: Ctx, id: string): Promise<Pelanggan> =>
  context.Pelanggan.getOrCreate({ id, jumlahOrder: 0, totalBayar: NOL, totalRefund: NOL, nft: 0, totalTopUp: NOL });

async function order(context: Ctx, id: bigint): Promise<Order | undefined> {
  const o = await context.Order.get(id.toString());
  if (!o) context.log.warn(`Order #${id} belum terindeks (start_block terlalu tinggi?)`);
  return o;
}

indexer.onEvent({ contract: "FotokopiKilat", event: "KatalogSet" }, async ({ event, context }) => {
  const p = event.params;
  context.Katalog.set({
    id: p.jenis.toString(), hargaDasar: p.hargaDasar, hargaPerHalaman: p.hargaPerHalaman,
    batasDasar: Number(p.batasDasar), batasPerHalaman: Number(p.batasPerHalaman),
    jumlahLangkah: Number(p.jumlahLangkah), label: p.label,
  });
});

indexer.onEvent({ contract: "FotokopiKilat", event: "ShopRegistered" }, async ({ event, context }) => {
  context.Toko.set({ id: event.params.toko, nama: event.params.nama, aktif: true, diclaim: 0, selesai: 0, gagal: 0, sengketa: 0, totalPayout: NOL, proSampai: undefined });
});

// v2.3: toko mendaftar sendiri (ShopRegistered di atas), ganti nama, dan bisa dinonaktifkan operator.
indexer.onEvent({ contract: "FotokopiKilat", event: "ShopRenamed" }, async ({ event, context }) => {
  const t = await context.Toko.get(event.params.toko);
  if (t) context.Toko.set({ ...t, nama: event.params.nama });
});

indexer.onEvent({ contract: "FotokopiKilat", event: "ShopStatusSet" }, async ({ event, context }) => {
  const t = await context.Toko.get(event.params.toko);
  if (t) context.Toko.set({ ...t, aktif: event.params.aktif });
});

indexer.onEvent({ contract: "FotokopiKilat", event: "SessionStarted" }, async ({ event, context }) => {
  const nomor = Number(event.params.sesiId);
  context.Sesi.set({ id: String(nomor), nomor, aktif: true, mulai: event.params.waktu, berakhir: undefined, jumlahOrder: 0, volume: NOL });
  context.Statistik.set({ ...(await statistik(context)), sesiAktif: nomor });
});

indexer.onEvent({ contract: "FotokopiKilat", event: "SessionEnded" }, async ({ event, context }) => {
  const s = await context.Sesi.get(event.params.sesiId.toString());
  if (s) context.Sesi.set({ ...s, aktif: false, berakhir: event.params.waktu });
  context.Statistik.set({ ...(await statistik(context)), sesiAktif: 0 });
});

indexer.onEvent({ contract: "FotokopiKilat", event: "FeeRelaySet" }, async ({ event, context }) => {
  context.Statistik.set({ ...(await statistik(context)), feeRelay: event.params.fee });
});

indexer.onEvent({ contract: "FotokopiKilat", event: "OrderCreated" }, async ({ event, context }) => {
  const p = event.params;
  const st = await statistik(context);
  // Order selalu dibuat saat sesi aktif (contract menolak bila tidak), jadi sesi = sesi aktif terakhir.
  const sesiId = String(st.sesiAktif);
  const [k, pl, s] = await Promise.all([
    context.Katalog.get(p.jenis.toString()), pelanggan(context, p.pelanggan), context.Sesi.get(sesiId),
  ]);
  context.Order.set({
    id: p.id.toString(), pelanggan_id: p.pelanggan, jenis: Number(p.jenis), label: k?.label ?? "", harga: p.harga,
    halaman: 1, batasKerja: 0, dokumen: undefined, pakaiKode: false, // diisi OrderDetail (tx yang sama)
    teks: p.teks, status: "Open", sesi_id: sesiId, toko_id: undefined, langkahSelesai: 0, dibuatPada: p.dibuatPada,
    diclaimPada: undefined, siapPada: undefined, selesaiPada: undefined, payoutTerkunci: undefined, diserahkan: undefined,
    kerja: undefined, payout: undefined, feePlatform: undefined, refund: undefined, diputuskanOtomatis: undefined,
    alasanExpire: undefined, viaRelayer: false, relayer: undefined, feeRelay: undefined, txBuat: event.transaction.hash,
  });
  context.Pelanggan.set({ ...pl, jumlahOrder: pl.jumlahOrder + 1, totalBayar: pl.totalBayar + p.harga });
  if (s) context.Sesi.set({ ...s, jumlahOrder: s.jumlahOrder + 1, volume: s.volume + p.harga });
  context.Statistik.set({ ...st, order: st.order + 1, volume: st.volume + p.harga });
});

// v2: rincian halaman, batas kerja, hash dokumen, dan kode serah terima; dipancarkan tepat setelah OrderCreated.
indexer.onEvent({ contract: "FotokopiKilat", event: "OrderDetail" }, async ({ event, context }) => {
  const p = event.params;
  const o = await order(context, p.id);
  if (!o) return;
  context.Order.set({
    ...o, halaman: Number(p.halaman), batasKerja: Number(p.batasKerja),
    dokumen: BigInt(p.dokumen) === NOL ? undefined : p.dokumen, pakaiKode: BigInt(p.kodeHash) !== NOL,
  });
});

// Dipancarkan di tx yang sama, setelah OrderCreated.
indexer.onEvent({ contract: "FotokopiKilat", event: "OrderRelayed" }, async ({ event, context }) => {
  const p = event.params;
  const o = await order(context, p.id);
  if (!o) return;
  context.Order.set({ ...o, viaRelayer: true, relayer: p.relayer, feeRelay: p.fee });
  const pl = await pelanggan(context, o.pelanggan_id);
  context.Pelanggan.set({ ...pl, totalBayar: pl.totalBayar + p.fee });
  const st = await statistik(context);
  context.Statistik.set({ ...st, relayed: st.relayed + 1 });
});

indexer.onEvent({ contract: "FotokopiKilat", event: "OrderClaimed" }, async ({ event, context }) => {
  const p = event.params;
  const o = await order(context, p.id);
  if (!o) return;
  context.Order.set({ ...o, status: "Claimed", toko_id: p.toko, diclaimPada: p.diclaimPada });
  const t = await context.Toko.get(p.toko);
  if (t) context.Toko.set({ ...t, diclaim: t.diclaim + 1 });
});

indexer.onEvent({ contract: "FotokopiKilat", event: "StepCompleted" }, async ({ event, context }) => {
  const o = await order(context, event.params.id);
  if (o) context.Order.set({ ...o, langkahSelesai: Number(event.params.urutan) });
});

// v2: langkah terakhir order berkode → Siap; payout terkunci, toko sudah bebas, menunggu serah terima QR.
indexer.onEvent({ contract: "FotokopiKilat", event: "OrderReady" }, async ({ event, context }) => {
  const p = event.params;
  const o = await order(context, p.id);
  if (o) context.Order.set({ ...o, status: "Siap", siapPada: p.siapPada, kerja: Number(p.kerja), payoutTerkunci: p.payout });
});

indexer.onEvent({ contract: "FotokopiKilat", event: "OrderFinished" }, async ({ event, context }) => {
  const p = event.params;
  const o = await order(context, p.id);
  if (!o) return;
  context.Order.set({
    ...o, status: "Finished", selesaiPada: BigInt(event.block.timestamp), kerja: Number(p.kerja),
    payout: p.payout, refund: p.refund, diserahkan: p.diserahkan,
  });
  const idOmzet = `${o.sesi_id}-${p.toko}`;
  const [t, om, pl, st] = await Promise.all([
    context.Toko.get(p.toko),
    context.OmzetSesi.getOrCreate({ id: idOmzet, sesi_id: o.sesi_id, toko_id: p.toko, omzet: NOL, selesai: 0 }),
    pelanggan(context, o.pelanggan_id),
    statistik(context),
  ]);
  if (t) context.Toko.set({ ...t, selesai: t.selesai + 1, totalPayout: t.totalPayout + p.payout });
  context.OmzetSesi.set({ ...om, omzet: om.omzet + p.payout, selesai: om.selesai + 1 });
  context.Pelanggan.set({ ...pl, totalRefund: pl.totalRefund + p.refund, nft: pl.nft + 1 });
  context.Statistik.set({ ...st, selesai: st.selesai + 1, payout: st.payout + p.payout, refund: st.refund + p.refund });
});

indexer.onEvent({ contract: "FotokopiKilat", event: "OrderExpired" }, async ({ event, context }) => {
  const p = event.params;
  const o = await order(context, p.id);
  if (!o) return;
  const alasan = ALASAN[Number(p.alasan)] ?? "Antre";
  context.Order.set({ ...o, status: "Expired", selesaiPada: BigInt(event.block.timestamp), refund: p.refund, alasanExpire: alasan });
  const [pl, st] = await Promise.all([pelanggan(context, o.pelanggan_id), statistik(context)]);
  context.Pelanggan.set({ ...pl, totalRefund: pl.totalRefund + p.refund });
  context.Statistik.set({ ...st, expired: st.expired + 1, refund: st.refund + p.refund });
  // Toko yang claim lalu lewat batas kerja dihitung gagal.
  if (alasan === "Kerja" && o.toko_id) {
    const t = await context.Toko.get(o.toko_id);
    if (t) context.Toko.set({ ...t, gagal: t.gagal + 1 });
  }
});

indexer.onEvent({ contract: "FotokopiKilat", event: "OrderDisputed" }, async ({ event, context }) => {
  const o = await order(context, event.params.id);
  if (!o) return;
  context.Order.set({ ...o, status: "Sengketa" });
  const st = await statistik(context);
  context.Statistik.set({ ...st, sengketa: st.sengketa + 1 });
  if (o.toko_id) {
    const t = await context.Toko.get(o.toko_id);
    if (t) context.Toko.set({ ...t, sengketa: t.sengketa + 1 });
  }
});

// Operator membagi payout terkunci; order sengketa tidak mendapat NFT.
indexer.onEvent({ contract: "FotokopiKilat", event: "DisputeResolved" }, async ({ event, context }) => {
  const p = event.params;
  const o = await order(context, p.id);
  if (!o) return;
  context.Order.set({ ...o, status: "Diputuskan", selesaiPada: BigInt(event.block.timestamp), payout: p.payout, refund: p.refund, diputuskanOtomatis: p.otomatis });
  const [t, om, pl, st] = await Promise.all([
    context.Toko.get(p.toko),
    context.OmzetSesi.getOrCreate({ id: `${o.sesi_id}-${p.toko}`, sesi_id: o.sesi_id, toko_id: p.toko, omzet: NOL, selesai: 0 }),
    pelanggan(context, o.pelanggan_id),
    statistik(context),
  ]);
  if (t) context.Toko.set({ ...t, totalPayout: t.totalPayout + p.payout });
  context.OmzetSesi.set({ ...om, omzet: om.omzet + p.payout });
  context.Pelanggan.set({ ...pl, totalRefund: pl.totalRefund + p.refund });
  context.Statistik.set({ ...st, payout: st.payout + p.payout, refund: st.refund + p.refund });
});

// ---------------------------------------------------------------- revenue v2.1

indexer.onEvent({ contract: "FotokopiKilat", event: "PlatformSet" }, async ({ event, context }) => {
  context.Statistik.set({ ...(await statistik(context)), platformFeeBps: Number(event.params.feeBps) });
});

// Dipancarkan setelah OrderFinished / DisputeResolved di tx yang sama.
indexer.onEvent({ contract: "FotokopiKilat", event: "PlatformFeeTaken" }, async ({ event, context }) => {
  const p = event.params;
  const o = await order(context, p.id);
  if (o) context.Order.set({ ...o, feePlatform: p.fee });
  const st = await statistik(context);
  context.Statistik.set({ ...st, pendapatanFee: st.pendapatanFee + p.fee });
});

indexer.onEvent({ contract: "FotokopiKilat", event: "ProSubscribed" }, async ({ event, context }) => {
  const p = event.params;
  const t = await context.Toko.get(p.toko);
  if (t) context.Toko.set({ ...t, proSampai: p.sampai });
  const st = await statistik(context);
  context.Statistik.set({ ...st, pendapatanPro: st.pendapatanPro + p.bayar });
});

