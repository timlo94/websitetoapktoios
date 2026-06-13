import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { getAdminData } from "@/lib/admin.functions";
import { getVisitorLogs } from "@/lib/visitor-logs.functions";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ShieldCheck, ArrowLeft, AlertTriangle, Globe } from "lucide-react";

export const Route = createFileRoute("/_authenticated/admin")({
  codeSplitGroupings: [],
  head: () => ({ meta: [{ title: "Admin — SoloSync" }] }),
  component: AdminPage,
});

function AdminPage() {
  const navigate = useNavigate();
  const fetchAdmin = useServerFn(getAdminData);
  const fetchVisitors = useServerFn(getVisitorLogs);
  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ["admin-data"],
    queryFn: () => fetchAdmin(),
    retry: false,
  });
  const visitorsQ = useQuery({
    queryKey: ["visitor-logs"],
    queryFn: () => fetchVisitors(),
    retry: false,
  });

  const forbidden = error instanceof Error && /forbidden/i.test(error.message);

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header className="border-b bg-white">
        <div className="mx-auto max-w-6xl px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-violet-600 to-indigo-600">
              <ShieldCheck className="h-5 w-5 text-white" />
            </div>
            <div>
              <h1 className="text-base font-bold">Admin</h1>
              <p className="text-xs text-slate-500">Role-gated panel · SoloSync</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={() => { refetch(); visitorsQ.refetch(); }} disabled={isFetching}>
              Refresh
            </Button>
            <Button variant="outline" size="sm" onClick={() => navigate({ to: "/" })}>
              <ArrowLeft className="h-4 w-4 mr-1" /> Back to workspace
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl p-6 space-y-6">
        {forbidden && (
          <Card className="p-6 border-amber-200 bg-amber-50">
            <div className="flex items-start gap-3">
              <AlertTriangle className="h-5 w-5 text-amber-600 mt-0.5" />
              <div>
                <h2 className="font-semibold text-amber-900">Access denied</h2>
                <p className="text-sm text-amber-800">
                  Your account does not have the <code>admin</code> role.
                </p>
              </div>
            </div>
          </Card>
        )}

        {!forbidden && error && (
          <Card className="p-6 border-red-200 bg-red-50">
            <p className="text-sm text-red-800">{(error as Error).message}</p>
          </Card>
        )}

        {isLoading && (
          <div className="grid gap-4 md:grid-cols-3">
            <Skeleton className="h-24" />
            <Skeleton className="h-24" />
            <Skeleton className="h-24" />
          </div>
        )}

        {data && (
          <>
            <div className="grid gap-4 md:grid-cols-3">
              <Stat label="Total users" value={data.totalUsers} />
              <Stat label="Google sign-ins" value={data.googleSignIns.length} />
              <Stat label="Recent signups (shown)" value={data.recentUsers.length} />
            </div>

            <Card className="p-0 overflow-hidden">
              <div className="px-5 py-3 border-b bg-white flex items-center justify-between">
                <h2 className="font-semibold text-sm">Google sign-in log</h2>
                <Badge variant="secondary">{data.googleSignIns.length}</Badge>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-slate-600">
                    <tr>
                      <Th>Email</Th>
                      <Th>User ID</Th>
                      <Th>Signed up</Th>
                      <Th>Last sign-in</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.googleSignIns.length === 0 && (
                      <tr><td colSpan={4} className="px-5 py-8 text-center text-slate-500">No Google sign-ins yet.</td></tr>
                    )}
                    {data.googleSignIns.map((u) => (
                      <tr key={u.id} className="border-t">
                        <Td>{u.email ?? "—"}</Td>
                        <Td className="font-mono text-xs text-slate-500">{u.id.slice(0, 8)}…</Td>
                        <Td>{fmt(u.created_at)}</Td>
                        <Td>{u.last_sign_in_at ? fmt(u.last_sign_in_at) : "—"}</Td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>

            <Card className="p-0 overflow-hidden">
              <div className="px-5 py-3 border-b bg-white">
                <h2 className="font-semibold text-sm">Recent signups</h2>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-slate-600">
                    <tr>
                      <Th>Email</Th>
                      <Th>Provider</Th>
                      <Th>Created</Th>
                      <Th>Last sign-in</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.recentUsers.map((u) => (
                      <tr key={u.id} className="border-t">
                        <Td>{u.email ?? "—"}</Td>
                        <Td>
                          <Badge variant={u.provider === "google" ? "default" : "secondary"}>
                            {u.provider ?? "email"}
                          </Badge>
                        </Td>
                        <Td>{fmt(u.created_at)}</Td>
                        <Td>{u.last_sign_in_at ? fmt(u.last_sign_in_at) : "—"}</Td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>

            <Card className="p-0 overflow-hidden">
              <div className="px-5 py-3 border-b bg-white flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Globe className="h-4 w-4 text-slate-500" />
                  <h2 className="font-semibold text-sm">Visitor logs (last 200)</h2>
                </div>
                <Badge variant="secondary">{visitorsQ.data?.total ?? 0} total · 90d retention</Badge>
              </div>
              {visitorsQ.isLoading && <div className="p-6"><Skeleton className="h-24" /></div>}
              {visitorsQ.error && (
                <p className="px-5 py-4 text-sm text-red-600">{(visitorsQ.error as Error).message}</p>
              )}
              {visitorsQ.data && (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50 text-slate-600">
                      <tr>
                        <Th>When</Th>
                        <Th>IP</Th>
                        <Th>Country</Th>
                        <Th>Path</Th>
                        <Th>User</Th>
                        <Th>User Agent</Th>
                      </tr>
                    </thead>
                    <tbody>
                      {visitorsQ.data.logs.length === 0 && (
                        <tr><td colSpan={6} className="px-5 py-8 text-center text-slate-500">No visits logged yet.</td></tr>
                      )}
                      {visitorsQ.data.logs.map((v) => (
                        <tr key={v.id} className="border-t">
                          <Td className="whitespace-nowrap">{fmt(v.created_at)}</Td>
                          <Td className="font-mono text-xs">{v.ip_address ?? "—"}</Td>
                          <Td>{v.country ?? "—"}</Td>
                          <Td className="max-w-[200px] truncate">{v.path ?? "—"}</Td>
                          <Td className="font-mono text-xs text-slate-500">
                            {v.user_id ? `${v.user_id.slice(0, 8)}…` : "guest"}
                          </Td>
                          <Td className="max-w-[280px] truncate text-xs text-slate-500" title={v.user_agent ?? ""}>
                            {v.user_agent ?? "—"}
                          </Td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>

            <p className="text-xs text-slate-500">
              Tip: open <Link to="/" className="underline">the workspace</Link> to keep working.
            </p>
          </>
        )}
      </main>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <Card className="p-5">
      <p className="text-xs text-slate-500 uppercase tracking-wide">{label}</p>
      <p className="text-3xl font-bold mt-1">{value}</p>
    </Card>
  );
}
function Th({ children }: { children: React.ReactNode }) {
  return <th className="text-left px-5 py-2 font-medium">{children}</th>;
}
function Td({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <td className={`px-5 py-2 ${className}`}>{children}</td>;
}
function fmt(iso: string) {
  try { return new Date(iso).toLocaleString(); } catch { return iso; }
}
