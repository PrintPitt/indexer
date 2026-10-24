// Uji handler dengan event simulasi (tanpa Docker, tanpa jaringan): satu sesi berisi
// top-up, order lewat relayer yang selesai, order yang lewat batas antre, dan order yang lewat batas kerja.
import { describe, it } from "vitest";
import { createTestIndexer } from "envio";

const TOKO_A = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
const TOKO_B = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC";
const PENONTON = "0x90F79bf6EB2c4f870365E785982E1f101E93b906";
const RELAYER = "0x14dC79964da2C08b23698B3D3cc7Ca32193d9955";
const NOL = "0x0000000000000000000000000000000000000000";
const RP = 100n; // tIDRX 2 desimal
const t0 = 1_800_000_000n;

const ev = (blok: number, item: Record<string, unknown>) => ({
  ...item, block: { number: blok, timestamp: Number(t0) + blok }, transaction: { hash: `0x${blok.toString(16).padStart(64, "0")}` },
});

async function jalankanSesi() {
  const indexer = createTestIndexer();
  await indexer.process({
    chains: {
      31337: {
        simulate: [
          ev(1, { contract: "FotokopiKilat", event: "KatalogSet", params: { jenis: 1n, hargaDasar: 5_000n * RP, hargaPerHalaman: 0n, batasDasar: 30n, batasPerHalaman: 0n, langkah: "0x01000000", jumlahLangkah: 1n, label: "FOTOKOPI KTP" } }),
          ev(1, { contract: "FotokopiKilat", event: "ShopRegistered", params: { toko: TOKO_A, nama: "Toko A" } }),
          ev(1, { contract: "FotokopiKilat", event: "ShopRegistered", params: { toko: TOKO_B, nama: "Toko B" } }),
          ev(1, { contract: "FotokopiKilat", event: "FeeRelaySet", params: { fee: 100n * RP } }),
          ev(2, { contract: "FotokopiKilat", event: "SessionStarted", params: { sesiId: 1n, waktu: t0 + 2n } }),
          ev(3, { contract: "TestIDRX", event: "Transfer", params: { from: NOL, to: PENONTON, value: 50_000n * RP } }),
          // order 1: lewat relayer, diclaim Toko A, selesai dalam 6 dtk
          ev(4, { contract: "FotokopiKilat", event: "OrderCreated", params: { id: 1n, pelanggan: PENONTON, jenis: 1n, harga: 5_000n * RP, teks: "KTP Budi", dibuatPada: t0 + 4n } }),
          ev(4, { contract: "FotokopiKilat", event: "OrderRelayed", params: { id: 1n, relayer: RELAYER, fee: 100n * RP } }),
          ev(5, { contract: "FotokopiKilat", event: "OrderClaimed", params: { id: 1n, toko: TOKO_A, diclaimPada: t0 + 5n } }),
          ev(11, { contract: "FotokopiKilat", event: "StepCompleted", params: { id: 1n, toko: TOKO_A, urutan: 1n, kode: 1n } }),
          ev(11, { contract: "FotokopiKilat", event: "OrderFinished", params: { id: 1n, toko: TOKO_A, payout: 4_000n * RP, refund: 1_000n * RP, kerja: 6n, diserahkan: true } }),
          // order 2: tidak ada yang claim -> expire antre (refund penuh)
          ev(12, { contract: "FotokopiKilat", event: "OrderCreated", params: { id: 2n, pelanggan: PENONTON, jenis: 1n, harga: 5_000n * RP, teks: "KTP Sari", dibuatPada: t0 + 12n } }),
          ev(60, { contract: "FotokopiKilat", event: "OrderExpired", params: { id: 2n, refund: 5_000n * RP, alasan: 0n } }),
          // order 3: diclaim Toko B tapi tidak selesai -> expire kerja
          ev(61, { contract: "FotokopiKilat", event: "OrderCreated", params: { id: 3n, pelanggan: PENONTON, jenis: 1n, harga: 5_000n * RP, teks: "KTP Joko", dibuatPada: t0 + 61n } }),
          ev(62, { contract: "FotokopiKilat", event: "OrderClaimed", params: { id: 3n, toko: TOKO_B, diclaimPada: t0 + 62n } }),
          ev(95, { contract: "FotokopiKilat", event: "OrderExpired", params: { id: 3n, refund: 5_000n * RP, alasan: 1n } }),
          ev(96, { contract: "FotokopiKilat", event: "SessionEnded", params: { sesiId: 1n, waktu: t0 + 96n } }),
        ],
      },
    },
  } as never);
  return indexer;
}

describe("FotokopiKilat indexer", () => {
  it("order relayer yang selesai: status, payout, fee, NFT", async (t) => {
    const ix = await jalankanSesi();
    const o = await ix.Order.getOrThrow("1");
    t.expect(o).toMatchObject({
      status: "Finished", toko_id: TOKO_A, pelanggan_id: PENONTON, sesi_id: "1", label: "FOTOKOPI KTP", diserahkan: true,
      langkahSelesai: 1, kerja: 6, payout: 400_000n, refund: 100_000n, viaRelayer: true, relayer: RELAYER, feeRelay: 10_000n,
      txBuat: `0x${(4).toString(16).padStart(64, "0")}`,
    });
  });

  it("expire antre dan expire kerja tercatat dengan alasannya", async (t) => {
    const ix = await jalankanSesi();
    t.expect(await ix.Order.getOrThrow("2")).toMatchObject({ status: "Expired", alasanExpire: "Antre", refund: 500_000n, toko_id: undefined });
    t.expect(await ix.Order.getOrThrow("3")).toMatchObject({ status: "Expired", alasanExpire: "Kerja", toko_id: TOKO_B });
    t.expect(await ix.Toko.getOrThrow(TOKO_B)).toMatchObject({ diclaim: 1, selesai: 0, gagal: 1, totalPayout: 0n });
  });

  it("leaderboard omzet per sesi sama dengan payout", async (t) => {
    const ix = await jalankanSesi();
    t.expect(await ix.OmzetSesi.getOrThrow(`1-${TOKO_A}`)).toMatchObject({ omzet: 400_000n, selesai: 1, toko_id: TOKO_A, sesi_id: "1" });
    t.expect(await ix.OmzetSesi.get(`1-${TOKO_B}`)).toBeUndefined();
    t.expect(await ix.Toko.getOrThrow(TOKO_A)).toMatchObject({ diclaim: 1, selesai: 1, gagal: 0, totalPayout: 400_000n });
    t.expect(await ix.Sesi.getOrThrow("1")).toMatchObject({ aktif: false, jumlahOrder: 3, volume: 1_500_000n, berakhir: t0 + 96n });
  });

  it("pelanggan dan statistik: top-up, bayar, refund, NFT", async (t) => {
    const ix = await jalankanSesi();
    // bayar = 3 order x Rp5.000 + fee Rp100; refund = Rp1.000 + Rp5.000 + Rp5.000
    t.expect(await ix.Pelanggan.getOrThrow(PENONTON)).toMatchObject({
      jumlahOrder: 3, totalBayar: 1_510_000n, totalRefund: 1_100_000n, nft: 1, totalTopUp: 5_000_000n,
    });
    t.expect(await ix.Statistik.getOrThrow("global")).toMatchObject({
      sesiAktif: 0, feeRelay: 10_000n, order: 3, selesai: 1, expired: 2, relayed: 1,
      volume: 1_500_000n, payout: 400_000n, refund: 1_100_000n, topUp: 5_000_000n,
    });
    const tu = await ix.TopUp.getAll();
    t.expect(tu).toHaveLength(1);
    t.expect(tu[0]).toMatchObject({ ke: PENONTON, jumlah: 5_000_000n });
  });

  it("Transfer biasa (bukan mint) tidak dihitung top-up", async (t) => {
    const ix = createTestIndexer();
    await ix.process({
      chains: { 31337: { simulate: [ev(1, { contract: "TestIDRX", event: "Transfer", params: { from: PENONTON, to: TOKO_A, value: 1n } })] } },
    } as never);
    t.expect(await ix.TopUp.getAll()).toHaveLength(0);
  });

  it("v2: order dokumen berkode → Siap → serah terima; order lain disengketakan lalu diputuskan", async (t) => {
    const ix = createTestIndexer();
    const DOK = `0x${"ab".repeat(32)}`, KODE = `0x${"cd".repeat(32)}`, NOL = `0x${"0".repeat(64)}`;
    await ix.process({
      chains: {
        31337: {
          simulate: [
            ev(1, { contract: "FotokopiKilat", event: "KatalogSet", params: { jenis: 5n, hargaDasar: 1_000n * RP, hargaPerHalaman: 500n * RP, batasDasar: 20n, batasPerHalaman: 3n, langkah: "0x02000000", jumlahLangkah: 1n, label: "PRINT DOKUMEN" } }),
            ev(1, { contract: "FotokopiKilat", event: "ShopRegistered", params: { toko: TOKO_A, nama: "Toko A" } }),
            ev(2, { contract: "FotokopiKilat", event: "SessionStarted", params: { sesiId: 1n, waktu: t0 + 2n } }),
            // order 1: 6 halaman, dokumen + kode → Siap → diserahkan
            ev(3, { contract: "FotokopiKilat", event: "OrderCreated", params: { id: 1n, pelanggan: PENONTON, jenis: 5n, harga: 4_000n * RP, teks: "Skripsi", dibuatPada: t0 + 3n } }),
            ev(3, { contract: "FotokopiKilat", event: "OrderDetail", params: { id: 1n, halaman: 6n, batasKerja: 38n, dokumen: DOK, kodeHash: KODE } }),
            ev(4, { contract: "FotokopiKilat", event: "OrderClaimed", params: { id: 1n, toko: TOKO_A, diclaimPada: t0 + 4n } }),
            ev(9, { contract: "FotokopiKilat", event: "OrderReady", params: { id: 1n, toko: TOKO_A, kerja: 5n, payout: 3_473n * RP, siapPada: t0 + 9n } }),
            ev(80, { contract: "FotokopiKilat", event: "OrderFinished", params: { id: 1n, toko: TOKO_A, payout: 3_473n * RP, refund: 527n * RP, kerja: 5n, diserahkan: true } }),
            // order 2: Siap lalu dikomplain, operator memberi toko separuh
            ev(81, { contract: "FotokopiKilat", event: "OrderCreated", params: { id: 2n, pelanggan: PENONTON, jenis: 5n, harga: 2_000n * RP, teks: "Makalah", dibuatPada: t0 + 81n } }),
            ev(81, { contract: "FotokopiKilat", event: "OrderDetail", params: { id: 2n, halaman: 2n, batasKerja: 26n, dokumen: NOL, kodeHash: KODE } }),
            ev(82, { contract: "FotokopiKilat", event: "OrderClaimed", params: { id: 2n, toko: TOKO_A, diclaimPada: t0 + 82n } }),
            ev(90, { contract: "FotokopiKilat", event: "OrderReady", params: { id: 2n, toko: TOKO_A, kerja: 8n, payout: 1_384n * RP, siapPada: t0 + 90n } }),
            ev(95, { contract: "FotokopiKilat", event: "OrderDisputed", params: { id: 2n } }),
            ev(120, { contract: "FotokopiKilat", event: "DisputeResolved", params: { id: 2n, toko: TOKO_A, payout: 692n * RP, refund: 1_308n * RP } }),
          ],
        },
      },
    } as never);
    t.expect(await ix.Katalog.getOrThrow("5")).toMatchObject({ hargaDasar: 100_000n, hargaPerHalaman: 50_000n, batasDasar: 20, batasPerHalaman: 3 });
    t.expect(await ix.Order.getOrThrow("1")).toMatchObject({
      status: "Finished", halaman: 6, batasKerja: 38, dokumen: DOK, pakaiKode: true, siapPada: t0 + 9n,
      payoutTerkunci: 347_300n, payout: 347_300n, diserahkan: true, kerja: 5,
    });
    t.expect(await ix.Order.getOrThrow("2")).toMatchObject({ status: "Diputuskan", dokumen: undefined, pakaiKode: true, payout: 69_200n, refund: 130_800n });
    t.expect(await ix.Toko.getOrThrow(TOKO_A)).toMatchObject({ selesai: 1, sengketa: 1, totalPayout: 347_300n + 69_200n });
    t.expect(await ix.OmzetSesi.getOrThrow(`1-${TOKO_A}`)).toMatchObject({ omzet: 347_300n + 69_200n, selesai: 1 });
    t.expect(await ix.Pelanggan.getOrThrow(PENONTON)).toMatchObject({ nft: 1, totalRefund: 52_700n + 130_800n });
    t.expect(await ix.Statistik.getOrThrow("global")).toMatchObject({ order: 2, selesai: 1, sengketa: 1 });
  });

  it("v2.1: fee platform dan langganan Toko Pro tercatat sebagai pendapatan", async (t) => {
    const ix = createTestIndexer();
    const TREASURY = "0x1D3a9498F7e32661f3729677d0D773b40F70EAF4";
    await ix.process({
      chains: {
        31337: {
          simulate: [
            ev(1, { contract: "FotokopiKilat", event: "ShopRegistered", params: { toko: TOKO_A, nama: "Toko A" } }),
            ev(1, { contract: "FotokopiKilat", event: "PlatformSet", params: { feeBps: 300n, treasury: TREASURY, hargaPro: 50_000n * RP } }),
            ev(2, { contract: "FotokopiKilat", event: "SessionStarted", params: { sesiId: 1n, waktu: t0 + 2n } }),
            ev(3, { contract: "FotokopiKilat", event: "OrderCreated", params: { id: 1n, pelanggan: PENONTON, jenis: 1n, harga: 5_000n * RP, teks: "KTP", dibuatPada: t0 + 3n } }),
            ev(4, { contract: "FotokopiKilat", event: "OrderClaimed", params: { id: 1n, toko: TOKO_A, diclaimPada: t0 + 4n } }),
            ev(8, { contract: "FotokopiKilat", event: "OrderFinished", params: { id: 1n, toko: TOKO_A, payout: 4_365n * RP, refund: 500n * RP, kerja: 3n, diserahkan: true } }),
            ev(8, { contract: "FotokopiKilat", event: "PlatformFeeTaken", params: { id: 1n, fee: 135n * RP } }),
            ev(9, { contract: "FotokopiKilat", event: "ProSubscribed", params: { toko: TOKO_A, sampai: t0 + 9n + 2_592_000n, bayar: 50_000n * RP } }),
          ],
        },
      },
    } as never);
    t.expect(await ix.Order.getOrThrow("1")).toMatchObject({ payout: 436_500n, feePlatform: 13_500n });
    t.expect(await ix.Toko.getOrThrow(TOKO_A)).toMatchObject({ proSampai: t0 + 9n + 2_592_000n, totalPayout: 436_500n });
    t.expect(await ix.Statistik.getOrThrow("global")).toMatchObject({ platformFeeBps: 300, pendapatanFee: 13_500n, pendapatanPro: 5_000_000n });
  });
});

