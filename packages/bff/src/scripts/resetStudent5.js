import pg from 'pg';
const { Client } = pg;

const client = new Client('postgresql://focit_user:focit_password@127.0.0.1:5432/focit_db');

async function reset() {
  await client.connect();
  await client.query("UPDATE course_registration_batches SET status = 'SUBMITTED', total_units = 17, submitted_at = NOW() WHERE student_id = 'student5'");
  console.log('RESET STUDENT5 TO SUBMITTED SUCCESSFUL');
  await client.end();
}

reset().catch(err => {
  console.error(err);
  process.exit(1);
});
