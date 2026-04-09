import Map "mo:core/Map";
import Time "mo:core/Time";
import Principal "mo:core/Principal";
import Runtime "mo:core/Runtime";

actor {
  type Stock = {
    symbol : Text;
    quantity : Nat;
    avgBuyPrice : Nat;
  };

  type Trade = {
    symbol : Text;
    tradeType : Text;
    quantity : Nat;
    price : Nat;
    timestamp : Time.Time;
    autoTrade : Bool;
  };

  type Portfolio = {
    balance : Nat;
    holdings : [Stock];
    tradeHistory : [Trade];
    watchlist : [Text];
    autoTradeSettings : [Text];
  };

  let portfolios = Map.empty<Principal, Portfolio>();

  // Owner: pehla registered user owner ban jaata hai
  var owner : ?Principal = null;

  public shared ({ caller }) func createPortfolio() : async () {
    if (portfolios.containsKey(caller)) { Runtime.trap("Portfolio already exists") };
    // Pehla user owner ban jaata hai
    if (owner == null) {
      owner := ?caller;
    };
    let newPortfolio : Portfolio = {
      balance = 1_000_000;
      holdings = [];
      tradeHistory = [];
      watchlist = [];
      autoTradeSettings = [];
    };
    portfolios.add(caller, newPortfolio);
  };

  public query ({ caller }) func isRegistered() : async Bool {
    portfolios.containsKey(caller);
  };

  // Check if caller is the app owner
  public query ({ caller }) func isOwner() : async Bool {
    switch (owner) {
      case (null) { false };
      case (?o) { Principal.equal(caller, o) };
    };
  };

  public query func getPortfolio(user : Principal) : async Portfolio {
    switch (portfolios.get(user)) {
      case (null) { Runtime.trap("Portfolio does not exist") };
      case (?portfolio) { portfolio };
    };
  };

  public query func getAllPortfolios() : async [Portfolio] {
    portfolios.values().toArray();
  };
};
