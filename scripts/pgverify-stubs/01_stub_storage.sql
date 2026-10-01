-- 01_stub_storage.sql
--
-- NOT a Supabase migration and never applied to a real Supabase project —
-- a real Supabase Postgres instance already provides a real `storage`
-- schema. This is the companion stand-in to 00_stub_supabase_auth.sql (see
-- that file's header), needed only because
-- supabase/migrations/0014_document_storage.sql inserts into
-- `storage.buckets` and creates policies on `storage.objects`, and later
-- migrations may reference `storage.foldername()`.

create schema if not exists storage;

create table if not exists storage.buckets (
  id text primary key,
  name text not null,
  public boolean not null default false,
  file_size_limit bigint,
  allowed_mime_types text[],
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets (id),
  name text,
  owner uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  metadata jsonb
);

alter table storage.objects enable row level security;

-- Real Supabase's storage.foldername(name) splits the object path on '/'
-- and drops the filename, returning the folder segments — this repo's
-- 0014_document_storage.sql policies use
-- (storage.foldername(name))[1] to read the leading <organization_id>
-- path segment.
create or replace function storage.foldername(name text)
returns text[]
language sql
immutable
as $$
  select case
    when position('/' in name) = 0 then array[]::text[]
    else string_to_array(regexp_replace(name, '/[^/]*$', ''), '/')
  end;
$$;

grant usage on schema storage to authenticated, anon, service_role;
grant select, insert, update, delete on storage.buckets, storage.objects to authenticated, anon, service_role;
