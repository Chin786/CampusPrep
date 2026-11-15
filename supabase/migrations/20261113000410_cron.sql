create extension if not exists pg_cron;
select cron.schedule('campusprep-expire-attempts','* * * * *','select private.sweep_expired()');
