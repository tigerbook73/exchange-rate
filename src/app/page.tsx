import { ThemeToggle } from "@/components/theme-toggle";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export default function Home() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-6 p-8">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>工商银行澳币购汇价</CardTitle>
          <CardDescription>
            脚手架验证页 — 后续阶段会替换为购汇价卡片与走势图
          </CardDescription>
        </CardHeader>
      </Card>
      <ThemeToggle />
    </main>
  );
}
