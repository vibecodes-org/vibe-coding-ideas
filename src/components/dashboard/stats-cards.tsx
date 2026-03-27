import { Lightbulb, Users, ChevronUp, CheckSquare } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

interface StatsCardsProps {
  ideasCount: number;
  collaborationsCount: number;
  upvotesReceived: number;
  tasksAssigned: number;
}

export function StatsCards({
  ideasCount,
  collaborationsCount,
  upvotesReceived,
  tasksAssigned,
}: StatsCardsProps) {
  const stats = [
    {
      label: "Ideas Created",
      value: ideasCount,
      icon: Lightbulb,
      color: "text-amber-400",
    },
    {
      label: "Collaborations",
      value: collaborationsCount,
      icon: Users,
      color: "text-blue-400",
    },
    {
      label: "Upvotes Received",
      value: upvotesReceived,
      icon: ChevronUp,
      color: "text-emerald-400",
    },
    {
      label: "Tasks Assigned",
      value: tasksAssigned,
      icon: CheckSquare,
      color: "text-blue-400",
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
      {stats.map((stat) => (
        <Card key={stat.label} data-testid={`stats-${stat.label.toLowerCase().replace(/\s+/g, "-")}`}>
          <CardContent className="flex items-center gap-3 p-4">
            <stat.icon className={`h-8 w-8 shrink-0 ${stat.color}`} />
            <div>
              <p className="text-2xl font-bold">{stat.value}</p>
              <p className="text-xs text-muted-foreground">{stat.label}</p>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
