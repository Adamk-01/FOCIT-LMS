import React, { useState } from 'react';
import { useHodAllocations, useHodEscalations, useHodAnalytics, useHodMutations } from '../hooks/useHodDashboard';

export function HodDashboardPage() {
  const [tab, setTab] = useState('clearance');
  return (
    <div className="p-6 max-w-6xl mx-auto">
      <h1 className="text-2xl font-bold mb-4">HOD Dashboard</h1>
      <nav className="flex gap-2 mb-6">
        {[['clearance', 'Clearance Desk'], ['allocations', 'Allocations'], ['analytics', 'Analytics']].map(([k, label]) => (
          <button key={k} onClick={() => setTab(k)}
            className={`px-4 py-2 rounded ${tab === k ? 'bg-[#0a1142] text-white' : 'bg-gray-100'}`}>
            {label}
          </button>
        ))}
      </nav>
      {tab === 'clearance' && <ClearanceDesk />}
      {tab === 'allocations' && <AllocationMatrix />}
      {tab === 'analytics' && <AnalyticsPanel />}
    </div>
  );
}

function ClearanceDesk() {
  const { data = [], isLoading, error } = useHodEscalations();
  const { decide } = useHodMutations();
  const [remarks, setRemarks] = useState({});
  if (isLoading) return <p>Loading…</p>;
  if (error) return <p role="alert">{error.detail || error.message}</p>;
  if (data.length === 0) return <p>No escalated overload registrations pending.</p>;
  return (
    <div className="space-y-3">
      {data.map((e) => (
        <div key={e.batch_id} className="border rounded p-4">
          <p><strong>{e.full_name}</strong> ({e.matric_number}) — {e.level}L — <span className="text-red-600 font-semibold">{e.total_units} units</span> [{e.status}]</p>
          <textarea className="w-full border rounded mt-2 p-2" placeholder="Decision remarks (min 5 chars)"
            value={remarks[e.batch_id] || ''}
            onChange={(ev) => setRemarks((r) => ({ ...r, [e.batch_id]: ev.target.value }))} />
          <div className="flex gap-2 mt-2">
            <button disabled={decide.isPending || (remarks[e.batch_id]?.length ?? 0) < 5}
              onClick={() => decide.mutate({ batchId: e.batch_id, decision: 'HOD_CLEARED', remarks: remarks[e.batch_id] })}
              className="bg-green-700 text-white px-4 py-1 rounded">Approve Override</button>
            <button disabled={decide.isPending || (remarks[e.batch_id]?.length ?? 0) < 5}
              onClick={() => decide.mutate({ batchId: e.batch_id, decision: 'REJECTED', remarks: remarks[e.batch_id] })}
              className="bg-red-700 text-white px-4 py-1 rounded">Reject</button>
          </div>
          {decide.isError && <p role="alert" className="text-red-600 mt-1">{decide.error?.detail || decide.error?.message}</p>}
        </div>
      ))}
    </div>
  );
}

function AllocationMatrix() {
  const { data = [], isLoading, error } = useHodAllocations();
  const { allocate } = useHodMutations();
  if (isLoading) return <p>Loading…</p>;
  if (error) return <p role="alert">{error.detail || error.message}</p>;
  return (
    <table className="w-full border">
      <thead><tr className="bg-gray-100 text-left">
        <th className="p-2">Code</th><th className="p-2">Title</th><th className="p-2">Units</th><th className="p-2">Level</th><th className="p-2">Lecturer</th>
      </tr></thead>
      <tbody>
        {data.map((r) => (
          <tr key={r.course_id} className="border-t">
            <td className="p-2">{r.code}</td><td className="p-2">{r.title}</td>
            <td className="p-2">{r.units}</td><td className="p-2">{r.level}L</td>
            <td className="p-2">{r.lecturer_name ?? <em className="text-gray-400">Unassigned</em>}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function AnalyticsPanel() {
  const { data, isLoading } = useHodAnalytics();
  if (isLoading || !data) return <p>Loading…</p>;
  return (
    <div className="space-y-6">
      <table className="w-full border">
        <thead><tr className="bg-gray-100">
          <th className="p-2">Level</th><th className="p-2">&lt;1.5</th><th className="p-2">1.5–2.49</th><th className="p-2">2.5–3.49</th><th className="p-2">≥3.5</th>
        </tr></thead>
        <tbody>
          {data.gpaDistribution.map((r) => (
            <tr key={r.level} className="border-t text-center">
              <td className="p-2">{r.level}L</td><td className="p-2">{r.bucket_lt_1_5}</td>
              <td className="p-2">{r.bucket_1_5_2_5}</td><td className="p-2">{r.bucket_2_5_3_5}</td>
              <td className="p-2">{r.bucket_gte_3_5}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <h2 className="font-semibold">At-Risk Students (CGPA &lt; 1.50)</h2>
      <table className="w-full border">
        <tbody>
          {data.atRiskStudents.map((s) => (
            <tr key={s.matric_number} className="border-t">
              <td className="p-2">{s.full_name}</td><td className="p-2">{s.matric_number}</td>
              <td className="p-2">{s.level}L</td><td className="p-2 text-red-600">{s.current_gpa}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
