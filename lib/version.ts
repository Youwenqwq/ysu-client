/** App metadata — version & build are injected at build time from package.json + git. */

export const APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION ?? "0.0.0"
export const APP_BUILD = process.env.NEXT_PUBLIC_APP_BUILD ?? "dev"
export const APP_COPYRIGHT = `© ${new Date().getFullYear()} Youwenqwq`
export const APP_LICENSE = "GPL-3.0"
export const APP_REPO = "https://github.com/Youwenqwq/ysu-client"
export const APP_WEBSITE = "https://ysu.welain.com/"

export const APP_OPEN_SOURCE: readonly { name: string; url: string }[] = [
  { name: "Next.js", url: "https://nextjs.org" },
  { name: "React", url: "https://react.dev" },
  { name: "Capacitor", url: "https://capacitorjs.com" },
  { name: "Radix UI", url: "https://www.radix-ui.com" },
  { name: "shadcn/ui", url: "https://ui.shadcn.com" },
  { name: "Tailwind CSS", url: "https://tailwindcss.com" },
  { name: "Zustand", url: "https://zustand-demo.pmnd.rs" },
  { name: "Lucide", url: "https://lucide.dev" },
]

export const APP_PEOPLE: readonly {
  name: string
  url?: string
  contribution?: string
}[] = [
  {
    name: "Rainight",
    url: "https://github.com/KamijoToma",
    contribution: "为本项目提供了 AI 资源支持",
  },
  {
    name: "Xiaomi Mimo",
    url: "https://mimo.xiaomi.com/",
    contribution: "为本项目提供了 Token Plan",
  },
  { name: "燕大终端的各位用户", contribution: "感谢大家使用本项目~" },
]
