import type { Principal } from "@icp-sdk/core/principal";
export interface Some<T> {
    __kind__: "Some";
    value: T;
}
export interface None {
    __kind__: "None";
}
export type Option<T> = Some<T> | None;
export interface Stock {
    quantity: bigint;
    avgBuyPrice: bigint;
    symbol: string;
}
export interface Portfolio {
    balance: bigint;
    tradeHistory: Array<Trade>;
    autoTradeSettings: Array<string>;
    holdings: Array<Stock>;
    watchlist: Array<string>;
}
export type Time = bigint;
export interface Trade {
    tradeType: string;
    timestamp: Time;
    quantity: bigint;
    price: bigint;
    symbol: string;
    autoTrade: boolean;
}
export interface backendInterface {
    createPortfolio(): Promise<void>;
    getAllPortfolios(): Promise<Array<Portfolio>>;
    getPortfolio(user: Principal): Promise<Portfolio>;
    isOwner(): Promise<boolean>;
    isRegistered(): Promise<boolean>;
}
