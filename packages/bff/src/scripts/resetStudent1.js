import pg from 'pg';
const { Client } = pg;

const client = new Client('postgresql://focit_user:focit_password@127.0.0.1:5432/focit_db');

async function reset() {
  await client.connect();
  await client.query("UPDATE course_registration_batches SET status = 'DRAFT', total_units = 0 WHERE student_id = 'student1'");
  await client.query("DELETE FROM course_registration_items WHERE batch_id = 'b0000000-0000-0000-0000-000000000001'");
  await client.query("DELETE FROM enrollments WHERE student_id = 'student1'");
  console.log('RESET STUDENT1 SUCCESSFUL');
  await client.end();
}

reset().catch(err => {
  console.error(err);
  process.exit(1);
});
