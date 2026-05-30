import { create } from "zustand";

interface MFAModalState {
  open: boolean;
  username: string;
  resolve: ((value: {
    type: "code";
    method: "sms" | "cpdaily";
    methodCode: string;
    code: string;
  } | {
    type: "wechat";
  }) => void) | null;
  reject: (() => void) | null;
  showMFA: (opts: {
    username: string;
    method?: "sms" | "cpdaily" | "weixin";
  }) => Promise<{
    type: "code";
    method: "sms" | "cpdaily";
    methodCode: string;
    code: string;
  } | {
    type: "wechat";
  }>;
  submitMFA: (payload: {
    method: "sms" | "cpdaily";
    methodCode: string;
    code: string;
  }) => void;
  completeWechatMFA: () => void;
  cancelMFA: () => void;
}

export const useMFAModalStore = create<MFAModalState>((set, get) => ({
  open: false,
  username: "",
  resolve: null,
  reject: null,

  showMFA: (opts) =>
    new Promise((resolve, reject) => {
      set({
        open: true,
        username: opts.username,
        resolve,
        reject,
      });
    }),

  submitMFA: (payload) => {
    const { resolve } = get();
    if (resolve) resolve({ type: "code", ...payload });
    set({ open: false, resolve: null, reject: null });
  },

  completeWechatMFA: () => {
    const { resolve } = get();
    if (resolve) resolve({ type: "wechat" });
    set({ open: false, resolve: null, reject: null });
  },

  cancelMFA: () => {
    const { reject } = get();
    if (reject) reject();
    set({ open: false, resolve: null, reject: null });
  },
}));
