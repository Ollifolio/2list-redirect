// global.d.ts — minimal typing for process.env in Edge Functions
declare const process: {
  env?: Record<string, string | undefined>;
};
