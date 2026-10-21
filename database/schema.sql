-- FA Management System - database structure (no data)
-- Generated 2026-10-21 from fa_management_staging.
-- New installation: create an empty database, run this file (psql or pgAdmin Query Tool),
-- then create the first Admin with: npm run seed (in the server folder).
-- The application itself applies later database changes (database/migrations) at each deployment.

--
-- PostgreSQL database dump
--

\restrict ugvrFZRshTzAEkciRYOFTSaYr2yUcR4hPe5B8lbpviA9X239GEW7id3vSPhG8kn

-- Dumped from database version 18.6
-- Dumped by pg_dump version 18.6

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: pg_trgm; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;


--
-- Name: EXTENSION pg_trgm; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION pg_trgm IS 'text similarity measurement and index searching based on trigrams';


--
-- Name: fa_records_book_month(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fa_records_book_month() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF NEW.book_month IS NULL OR NEW.book_month = '' THEN
    NEW.book_month := to_char(NEW.inv_date, 'YYYY-MM');
  END IF;
  INSERT INTO month_periods (book_month) VALUES (NEW.book_month) ON CONFLICT DO NOTHING;
  RETURN NEW;
END $$;


--
-- Name: fa_records_search_text(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fa_records_search_text() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  NEW.search_text := fa_records_search_text_of(NEW);
  RETURN NEW;
END $$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: fa_records; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.fa_records (
    fa_id integer NOT NULL,
    fa_code character varying(20) NOT NULL,
    inv_no character varying(200) NOT NULL,
    inv_date date NOT NULL,
    po_no character varying(200) NOT NULL,
    cost_center character varying(200) NOT NULL,
    amount numeric(15,2) NOT NULL,
    vendor character varying(300) NOT NULL,
    expense_head character varying(300) NOT NULL,
    narration text DEFAULT ''::text NOT NULL,
    status character varying(10) DEFAULT 'Pending'::character varying NOT NULL,
    plotted_at timestamp without time zone,
    plotted_by character varying(150),
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    period date GENERATED ALWAYS AS ((date_trunc('month'::text, (inv_date)::timestamp without time zone))::date) STORED,
    book_month character varying(7) NOT NULL,
    search_text text DEFAULT ''::text NOT NULL,
    CONSTRAINT fa_records_amount_check CHECK ((amount <> (0)::numeric)),
    CONSTRAINT fa_records_book_month_chk CHECK (((book_month)::text ~ '^\d{4}-(0[1-9]|1[0-2])$'::text)),
    CONSTRAINT fa_records_status_check CHECK (((status)::text = ANY (ARRAY[('Pending'::character varying)::text, ('Completed'::character varying)::text])))
);


--
-- Name: fa_records_search_text_of(public.fa_records); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fa_records_search_text_of(r public.fa_records) RETURNS text
    LANGUAGE sql STABLE
    AS $$
  SELECT LOWER(concat_ws(' ', r.fa_code, r.inv_no, to_char(r.inv_date, 'DD/MM/YYYY'), r.po_no, r.cost_center, r.amount::text,
    r.vendor, r.expense_head, r.status, r.plotted_by, to_char(r.plotted_at, 'DD/MM/YYYY'),
    to_char(to_date(r.book_month, 'YYYY-MM'), 'Mon YYYY')))
$$;


--
-- Name: lwm_tally_book_month(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.lwm_tally_book_month() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF NEW.book_month IS NULL OR NEW.book_month = '' THEN
    NEW.book_month := to_char(CURRENT_DATE, 'YYYY-MM');
  END IF;
  RETURN NEW;
END $$;


--
-- Name: activity_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.activity_log (
    log_id bigint NOT NULL,
    logged_at timestamp without time zone DEFAULT now() NOT NULL,
    username character varying(100) DEFAULT ''::character varying NOT NULL,
    name character varying(150) DEFAULT ''::character varying NOT NULL,
    action character varying(100) NOT NULL,
    module character varying(100) DEFAULT ''::character varying NOT NULL,
    fa_code character varying(20) DEFAULT ''::character varying NOT NULL,
    inv_no character varying(200) DEFAULT ''::character varying NOT NULL,
    expense_head character varying(300) DEFAULT ''::character varying NOT NULL,
    details text DEFAULT ''::text NOT NULL
);


--
-- Name: activity_log_log_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.activity_log_log_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: activity_log_log_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.activity_log_log_id_seq OWNED BY public.activity_log.log_id;


--
-- Name: app_releases; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.app_releases (
    release_id integer NOT NULL,
    version character varying(20) NOT NULL,
    environment character varying(20) NOT NULL,
    status character varying(12) DEFAULT 'deployed'::character varying NOT NULL,
    deployed_by character varying(150) DEFAULT ''::character varying NOT NULL,
    deployed_at timestamp without time zone DEFAULT now() NOT NULL,
    backup_file character varying(500) DEFAULT ''::character varying NOT NULL,
    migrations text DEFAULT ''::text NOT NULL,
    notes text DEFAULT ''::text NOT NULL,
    approved_by character varying(150),
    approved_at timestamp without time zone,
    approval_note text DEFAULT ''::text NOT NULL,
    CONSTRAINT app_releases_status_check CHECK (((status)::text = ANY ((ARRAY['deployed'::character varying, 'failed'::character varying, 'rolled back'::character varying, 'replaced'::character varying])::text[])))
);


--
-- Name: app_releases_release_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.app_releases_release_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: app_releases_release_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.app_releases_release_id_seq OWNED BY public.app_releases.release_id;


--
-- Name: archive_runs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.archive_runs (
    run_id integer NOT NULL,
    from_month character varying(7) NOT NULL,
    to_month character varying(7) NOT NULL,
    label character varying(60) NOT NULL,
    status character varying(12) DEFAULT 'running'::character varying NOT NULL,
    record_count integer DEFAULT 0 NOT NULL,
    line_count integer DEFAULT 0 NOT NULL,
    total_amount numeric(15,2) DEFAULT 0 NOT NULL,
    table_counts jsonb DEFAULT '{}'::jsonb NOT NULL,
    summary jsonb DEFAULT '[]'::jsonb NOT NULL,
    backup_file character varying(500) DEFAULT ''::character varying NOT NULL,
    backup_bytes bigint DEFAULT 0 NOT NULL,
    error text DEFAULT ''::text NOT NULL,
    created_by character varying(150) DEFAULT ''::character varying NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    finished_at timestamp without time zone,
    restored_by character varying(150),
    restored_at timestamp without time zone,
    restore_backup_file character varying(500) DEFAULT ''::character varying NOT NULL,
    CONSTRAINT archive_runs_status_check CHECK (((status)::text = ANY ((ARRAY['running'::character varying, 'archived'::character varying, 'failed'::character varying, 'restored'::character varying])::text[])))
);


--
-- Name: archive_runs_run_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.archive_runs_run_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: archive_runs_run_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.archive_runs_run_id_seq OWNED BY public.archive_runs.run_id;


--
-- Name: branch_master; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.branch_master (
    id integer NOT NULL,
    cost_center character varying(200) NOT NULL,
    branch character varying(300) DEFAULT ''::character varying NOT NULL,
    branch_code character varying(100) DEFAULT ''::character varying NOT NULL,
    location character varying(300) DEFAULT ''::character varying NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone
);


--
-- Name: branch_master_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.branch_master_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: branch_master_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.branch_master_id_seq OWNED BY public.branch_master.id;


--
-- Name: category_master; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.category_master (
    id integer NOT NULL,
    expense_head character varying(300) NOT NULL,
    category_level_1 character varying(300) DEFAULT ''::character varying NOT NULL,
    category_level_2 character varying(300) DEFAULT ''::character varying NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone
);


--
-- Name: category_master_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.category_master_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: category_master_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.category_master_id_seq OWNED BY public.category_master.id;


--
-- Name: change_history; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.change_history (
    change_id integer NOT NULL,
    fa_code character varying(20) NOT NULL,
    book_month character varying(7) DEFAULT ''::character varying NOT NULL,
    line_id integer,
    field character varying(100) NOT NULL,
    old_value text DEFAULT ''::text NOT NULL,
    new_value text DEFAULT ''::text NOT NULL,
    source character varying(40) DEFAULT ''::character varying NOT NULL,
    username character varying(100) DEFAULT ''::character varying NOT NULL,
    name character varying(150) DEFAULT ''::character varying NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: change_history_change_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.change_history_change_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: change_history_change_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.change_history_change_id_seq OWNED BY public.change_history.change_id;


--
-- Name: client_cc_master; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.client_cc_master (
    id integer NOT NULL,
    client_as_per_pmo character varying(300) NOT NULL,
    cost_center character varying(200) DEFAULT ''::character varying NOT NULL,
    status character varying(50) DEFAULT ''::character varying NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone
);


--
-- Name: client_cc_master_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.client_cc_master_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: client_cc_master_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.client_cc_master_id_seq OWNED BY public.client_cc_master.id;


--
-- Name: client_master; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.client_master (
    id integer NOT NULL,
    client_name character varying(300) NOT NULL,
    client_code character varying(100) DEFAULT ''::character varying NOT NULL,
    status character varying(50) DEFAULT ''::character varying NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone
);


--
-- Name: client_master_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.client_master_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: client_master_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.client_master_id_seq OWNED BY public.client_master.id;


--
-- Name: description_master; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.description_master (
    id integer NOT NULL,
    product_description character varying(300) NOT NULL,
    expense_head character varying(300) DEFAULT ''::character varying NOT NULL,
    asset_description_one character varying(300) DEFAULT ''::character varying NOT NULL,
    asset_description_two character varying(300) DEFAULT ''::character varying NOT NULL,
    category_level_2 character varying(300) DEFAULT ''::character varying NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone
);


--
-- Name: description_master_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.description_master_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: description_master_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.description_master_id_seq OWNED BY public.description_master.id;


--
-- Name: fa_code_counters; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.fa_code_counters (
    period character varying(7) NOT NULL,
    last_number integer NOT NULL
);


--
-- Name: fa_periods; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.fa_periods (
    period date NOT NULL,
    status character varying(10) DEFAULT 'Current'::character varying NOT NULL,
    opened_at timestamp without time zone DEFAULT now() NOT NULL,
    moved_at timestamp without time zone,
    moved_by character varying(150),
    records_at_move integer,
    amount_at_move numeric(15,2),
    pending_at_move integer,
    CONSTRAINT fa_periods_status_check CHECK (((status)::text = ANY (ARRAY[('Current'::character varying)::text, ('History'::character varying)::text])))
);


--
-- Name: fa_records_archive; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.fa_records_archive (
    fa_id integer NOT NULL,
    fa_code character varying(20) NOT NULL,
    inv_no character varying(200) NOT NULL,
    inv_date date NOT NULL,
    po_no character varying(200) NOT NULL,
    cost_center character varying(200) NOT NULL,
    amount numeric(15,2) NOT NULL,
    vendor character varying(300) NOT NULL,
    expense_head character varying(300) NOT NULL,
    narration text DEFAULT ''::text NOT NULL,
    status character varying(10) NOT NULL,
    plotted_at timestamp without time zone,
    plotted_by character varying(150),
    created_at timestamp without time zone NOT NULL,
    updated_at timestamp without time zone NOT NULL,
    archived_at timestamp without time zone DEFAULT now() NOT NULL,
    archived_by character varying(150)
);


--
-- Name: fa_records_fa_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.fa_records_fa_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: fa_records_fa_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.fa_records_fa_id_seq OWNED BY public.fa_records.fa_id;


--
-- Name: ledgers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ledgers (
    ledger_id integer NOT NULL,
    expense_head character varying(300) NOT NULL,
    mapping character varying(15) NOT NULL,
    active character varying(3) DEFAULT 'Yes'::character varying NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone,
    CONSTRAINT ledgers_active_check CHECK (((active)::text = ANY (ARRAY[('Yes'::character varying)::text, ('No'::character varying)::text]))),
    CONSTRAINT ledgers_mapping_check CHECK (((mapping)::text = ANY (ARRAY[('Taggable'::character varying)::text, ('Non Taggable'::character varying)::text])))
);


--
-- Name: ledgers_ledger_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.ledgers_ledger_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: ledgers_ledger_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.ledgers_ledger_id_seq OWNED BY public.ledgers.ledger_id;


--
-- Name: login_attempts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.login_attempts (
    attempt_id integer NOT NULL,
    user_id integer NOT NULL,
    device character varying(100) DEFAULT ''::character varying NOT NULL,
    ip character varying(64) DEFAULT ''::character varying NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    notified_at timestamp without time zone
);


--
-- Name: login_attempts_attempt_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.login_attempts_attempt_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: login_attempts_attempt_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.login_attempts_attempt_id_seq OWNED BY public.login_attempts.attempt_id;


--
-- Name: lwm_tally; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.lwm_tally (
    lwm_id integer NOT NULL,
    expense_head character varying(300) NOT NULL,
    amount numeric(15,2) NOT NULL,
    uploaded_at timestamp without time zone DEFAULT now() NOT NULL,
    book_month character varying(7) NOT NULL
);


--
-- Name: lwm_tally_lwm_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.lwm_tally_lwm_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: lwm_tally_lwm_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.lwm_tally_lwm_id_seq OWNED BY public.lwm_tally.lwm_id;


--
-- Name: month_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.month_events (
    event_id integer NOT NULL,
    book_month character varying(7) NOT NULL,
    action character varying(40) NOT NULL,
    status_from character varying(20) DEFAULT ''::character varying NOT NULL,
    status_to character varying(20) DEFAULT ''::character varying NOT NULL,
    username character varying(100) DEFAULT ''::character varying NOT NULL,
    name character varying(150) DEFAULT ''::character varying NOT NULL,
    details text DEFAULT ''::text NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: month_events_event_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.month_events_event_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: month_events_event_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.month_events_event_id_seq OWNED BY public.month_events.event_id;


--
-- Name: month_periods; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.month_periods (
    book_month character varying(7) NOT NULL,
    status character varying(20) DEFAULT 'Open'::character varying NOT NULL,
    version integer DEFAULT 0 NOT NULL,
    submitted_by character varying(150),
    submitted_at timestamp without time zone,
    finalized_by character varying(150),
    finalized_at timestamp without time zone,
    lwm_remark text DEFAULT ''::text NOT NULL,
    fams_reference character varying(200) DEFAULT ''::character varying NOT NULL,
    fams_uploaded_on date,
    fams_uploaded_by character varying(150),
    reopened_by character varying(150),
    reopened_at timestamp without time zone,
    reopen_reason text DEFAULT ''::text NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    CONSTRAINT month_periods_status_check CHECK (((status)::text = ANY (ARRAY[('Open'::character varying)::text, ('Under Review'::character varying)::text, ('Finalized'::character varying)::text, ('FAMS Uploaded'::character varying)::text])))
);


--
-- Name: month_snapshots; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.month_snapshots (
    snapshot_id integer NOT NULL,
    book_month character varying(7) NOT NULL,
    version integer NOT NULL,
    kind character varying(10) DEFAULT 'finalized'::character varying NOT NULL,
    record_count integer NOT NULL,
    line_count integer NOT NULL,
    total_amount numeric(15,2) NOT NULL,
    fingerprint character(64) NOT NULL,
    fams_rows jsonb NOT NULL,
    changes jsonb,
    change_count integer DEFAULT 0 NOT NULL,
    created_by character varying(150) DEFAULT ''::character varying NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    CONSTRAINT month_snapshots_kind_check CHECK (((kind)::text = ANY (ARRAY[('finalized'::character varying)::text, ('baseline'::character varying)::text])))
);


--
-- Name: month_snapshots_snapshot_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.month_snapshots_snapshot_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: month_snapshots_snapshot_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.month_snapshots_snapshot_id_seq OWNED BY public.month_snapshots.snapshot_id;


--
-- Name: po_master; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.po_master (
    id integer NOT NULL,
    po_no character varying(200) NOT NULL,
    po_date character varying(50) DEFAULT ''::character varying NOT NULL,
    client_as_per_po character varying(300) DEFAULT ''::character varying NOT NULL,
    client_as_per_pmo character varying(300) DEFAULT ''::character varying NOT NULL,
    status character varying(50) DEFAULT ''::character varying NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone
);


--
-- Name: po_master_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.po_master_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: po_master_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.po_master_id_seq OWNED BY public.po_master.id;


--
-- Name: products; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.products (
    product_id integer NOT NULL,
    product_name character varying(300) NOT NULL
);


--
-- Name: products_product_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.products_product_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: products_product_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.products_product_id_seq OWNED BY public.products.product_id;


--
-- Name: qty_lines; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.qty_lines (
    line_id integer NOT NULL,
    fa_id integer NOT NULL,
    line_no integer NOT NULL,
    product character varying(300) NOT NULL,
    quantity numeric(14,4) NOT NULL,
    taggable character varying(15) DEFAULT ''::character varying NOT NULL,
    unit_price numeric(18,6) NOT NULL,
    product_amount numeric(15,2) NOT NULL,
    gst_pct numeric(6,2) DEFAULT 0 NOT NULL,
    against_invoice_no character varying(200) DEFAULT ''::character varying NOT NULL,
    against_asset_code character varying(200) DEFAULT ''::character varying NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: qty_lines_archive; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.qty_lines_archive (
    line_id integer NOT NULL,
    fa_id integer NOT NULL,
    line_no integer NOT NULL,
    product character varying(300) NOT NULL,
    quantity numeric(14,4) NOT NULL,
    taggable character varying(15) NOT NULL,
    unit_price numeric(18,6) NOT NULL,
    product_amount numeric(15,2) NOT NULL,
    gst_pct numeric(6,2) DEFAULT 0 NOT NULL,
    against_invoice_no character varying(200) DEFAULT ''::character varying NOT NULL,
    against_asset_code character varying(200) DEFAULT ''::character varying NOT NULL,
    created_at timestamp without time zone NOT NULL,
    updated_at timestamp without time zone NOT NULL
);


--
-- Name: qty_lines_line_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.qty_lines_line_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: qty_lines_line_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.qty_lines_line_id_seq OWNED BY public.qty_lines.line_id;


--
-- Name: qty_locks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.qty_locks (
    fa_id integer NOT NULL,
    user_id integer NOT NULL,
    locked_at timestamp without time zone DEFAULT now() NOT NULL,
    last_seen_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: schema_migrations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.schema_migrations (
    filename character varying(255) NOT NULL,
    applied_at timestamp without time zone DEFAULT now() NOT NULL,
    checksum character(64)
);


--
-- Name: sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sessions (
    token_hash character(64) NOT NULL,
    user_id integer NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    expires_at timestamp without time zone NOT NULL,
    last_seen_at timestamp without time zone DEFAULT now() NOT NULL,
    ended_at timestamp without time zone,
    ended_reason character varying(30),
    user_agent character varying(300) DEFAULT ''::character varying NOT NULL,
    last_ping_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.users (
    user_id integer NOT NULL,
    username character varying(100) NOT NULL,
    password_hash character varying(255) NOT NULL,
    name character varying(150) NOT NULL,
    role character varying(10) DEFAULT 'User'::character varying NOT NULL,
    active character varying(3) DEFAULT 'Yes'::character varying NOT NULL,
    email character varying(255),
    department character varying(150),
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone,
    CONSTRAINT users_active_check CHECK (((active)::text = ANY (ARRAY[('Yes'::character varying)::text, ('No'::character varying)::text]))),
    CONSTRAINT users_role_check CHECK (((role)::text = ANY (ARRAY[('Admin'::character varying)::text, ('User'::character varying)::text])))
);


--
-- Name: users_user_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.users_user_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: users_user_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.users_user_id_seq OWNED BY public.users.user_id;


--
-- Name: activity_log log_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.activity_log ALTER COLUMN log_id SET DEFAULT nextval('public.activity_log_log_id_seq'::regclass);


--
-- Name: app_releases release_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_releases ALTER COLUMN release_id SET DEFAULT nextval('public.app_releases_release_id_seq'::regclass);


--
-- Name: archive_runs run_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.archive_runs ALTER COLUMN run_id SET DEFAULT nextval('public.archive_runs_run_id_seq'::regclass);


--
-- Name: branch_master id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.branch_master ALTER COLUMN id SET DEFAULT nextval('public.branch_master_id_seq'::regclass);


--
-- Name: category_master id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.category_master ALTER COLUMN id SET DEFAULT nextval('public.category_master_id_seq'::regclass);


--
-- Name: change_history change_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.change_history ALTER COLUMN change_id SET DEFAULT nextval('public.change_history_change_id_seq'::regclass);


--
-- Name: client_cc_master id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_cc_master ALTER COLUMN id SET DEFAULT nextval('public.client_cc_master_id_seq'::regclass);


--
-- Name: client_master id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_master ALTER COLUMN id SET DEFAULT nextval('public.client_master_id_seq'::regclass);


--
-- Name: description_master id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.description_master ALTER COLUMN id SET DEFAULT nextval('public.description_master_id_seq'::regclass);


--
-- Name: fa_records fa_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fa_records ALTER COLUMN fa_id SET DEFAULT nextval('public.fa_records_fa_id_seq'::regclass);


--
-- Name: ledgers ledger_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ledgers ALTER COLUMN ledger_id SET DEFAULT nextval('public.ledgers_ledger_id_seq'::regclass);


--
-- Name: login_attempts attempt_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.login_attempts ALTER COLUMN attempt_id SET DEFAULT nextval('public.login_attempts_attempt_id_seq'::regclass);


--
-- Name: lwm_tally lwm_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lwm_tally ALTER COLUMN lwm_id SET DEFAULT nextval('public.lwm_tally_lwm_id_seq'::regclass);


--
-- Name: month_events event_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.month_events ALTER COLUMN event_id SET DEFAULT nextval('public.month_events_event_id_seq'::regclass);


--
-- Name: month_snapshots snapshot_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.month_snapshots ALTER COLUMN snapshot_id SET DEFAULT nextval('public.month_snapshots_snapshot_id_seq'::regclass);


--
-- Name: po_master id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.po_master ALTER COLUMN id SET DEFAULT nextval('public.po_master_id_seq'::regclass);


--
-- Name: products product_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.products ALTER COLUMN product_id SET DEFAULT nextval('public.products_product_id_seq'::regclass);


--
-- Name: qty_lines line_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.qty_lines ALTER COLUMN line_id SET DEFAULT nextval('public.qty_lines_line_id_seq'::regclass);


--
-- Name: users user_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users ALTER COLUMN user_id SET DEFAULT nextval('public.users_user_id_seq'::regclass);


--
-- Name: activity_log activity_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.activity_log
    ADD CONSTRAINT activity_log_pkey PRIMARY KEY (log_id);


--
-- Name: app_releases app_releases_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_releases
    ADD CONSTRAINT app_releases_pkey PRIMARY KEY (release_id);


--
-- Name: archive_runs archive_runs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.archive_runs
    ADD CONSTRAINT archive_runs_pkey PRIMARY KEY (run_id);


--
-- Name: branch_master branch_master_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.branch_master
    ADD CONSTRAINT branch_master_pkey PRIMARY KEY (id);


--
-- Name: category_master category_master_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.category_master
    ADD CONSTRAINT category_master_pkey PRIMARY KEY (id);


--
-- Name: change_history change_history_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.change_history
    ADD CONSTRAINT change_history_pkey PRIMARY KEY (change_id);


--
-- Name: client_cc_master client_cc_master_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_cc_master
    ADD CONSTRAINT client_cc_master_pkey PRIMARY KEY (id);


--
-- Name: client_master client_master_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_master
    ADD CONSTRAINT client_master_pkey PRIMARY KEY (id);


--
-- Name: description_master description_master_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.description_master
    ADD CONSTRAINT description_master_pkey PRIMARY KEY (id);


--
-- Name: fa_code_counters fa_code_counters_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fa_code_counters
    ADD CONSTRAINT fa_code_counters_pkey PRIMARY KEY (period);


--
-- Name: fa_periods fa_periods_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fa_periods
    ADD CONSTRAINT fa_periods_pkey PRIMARY KEY (period);


--
-- Name: fa_records_archive fa_records_archive_fa_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fa_records_archive
    ADD CONSTRAINT fa_records_archive_fa_code_key UNIQUE (fa_code);


--
-- Name: fa_records_archive fa_records_archive_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fa_records_archive
    ADD CONSTRAINT fa_records_archive_pkey PRIMARY KEY (fa_id);


--
-- Name: fa_records fa_records_fa_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fa_records
    ADD CONSTRAINT fa_records_fa_code_key UNIQUE (fa_code);


--
-- Name: fa_records fa_records_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fa_records
    ADD CONSTRAINT fa_records_pkey PRIMARY KEY (fa_id);


--
-- Name: ledgers ledgers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ledgers
    ADD CONSTRAINT ledgers_pkey PRIMARY KEY (ledger_id);


--
-- Name: login_attempts login_attempts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.login_attempts
    ADD CONSTRAINT login_attempts_pkey PRIMARY KEY (attempt_id);


--
-- Name: lwm_tally lwm_tally_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lwm_tally
    ADD CONSTRAINT lwm_tally_pkey PRIMARY KEY (lwm_id);


--
-- Name: month_events month_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.month_events
    ADD CONSTRAINT month_events_pkey PRIMARY KEY (event_id);


--
-- Name: month_periods month_periods_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.month_periods
    ADD CONSTRAINT month_periods_pkey PRIMARY KEY (book_month);


--
-- Name: month_snapshots month_snapshots_book_month_version_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.month_snapshots
    ADD CONSTRAINT month_snapshots_book_month_version_key UNIQUE (book_month, version);


--
-- Name: month_snapshots month_snapshots_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.month_snapshots
    ADD CONSTRAINT month_snapshots_pkey PRIMARY KEY (snapshot_id);


--
-- Name: po_master po_master_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.po_master
    ADD CONSTRAINT po_master_pkey PRIMARY KEY (id);


--
-- Name: products products_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.products
    ADD CONSTRAINT products_pkey PRIMARY KEY (product_id);


--
-- Name: qty_lines_archive qty_lines_archive_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.qty_lines_archive
    ADD CONSTRAINT qty_lines_archive_pkey PRIMARY KEY (line_id);


--
-- Name: qty_lines qty_lines_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.qty_lines
    ADD CONSTRAINT qty_lines_pkey PRIMARY KEY (line_id);


--
-- Name: qty_locks qty_locks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.qty_locks
    ADD CONSTRAINT qty_locks_pkey PRIMARY KEY (fa_id);


--
-- Name: schema_migrations schema_migrations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schema_migrations
    ADD CONSTRAINT schema_migrations_pkey PRIMARY KEY (filename);


--
-- Name: sessions sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sessions
    ADD CONSTRAINT sessions_pkey PRIMARY KEY (token_hash);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (user_id);


--
-- Name: activity_log_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX activity_log_at_idx ON public.activity_log USING btree (logged_at DESC);


--
-- Name: app_releases_version_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX app_releases_version_idx ON public.app_releases USING btree (environment, version);


--
-- Name: archive_runs_months_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX archive_runs_months_idx ON public.archive_runs USING btree (from_month, to_month) WHERE ((status)::text = 'archived'::text);


--
-- Name: change_history_fa_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX change_history_fa_idx ON public.change_history USING btree (fa_code, change_id);


--
-- Name: change_history_month_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX change_history_month_idx ON public.change_history USING btree (book_month, change_id);


--
-- Name: fa_records_book_month_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX fa_records_book_month_idx ON public.fa_records USING btree (book_month);


--
-- Name: fa_records_cost_center_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX fa_records_cost_center_idx ON public.fa_records USING btree (lower(TRIM(BOTH FROM cost_center)));


--
-- Name: fa_records_date_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX fa_records_date_idx ON public.fa_records USING btree (inv_date);


--
-- Name: fa_records_inv_no_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX fa_records_inv_no_trgm ON public.fa_records USING gin (lower((inv_no)::text) public.gin_trgm_ops);


--
-- Name: fa_records_pending_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX fa_records_pending_idx ON public.fa_records USING btree (fa_id) WHERE ((status)::text <> 'Completed'::text);


--
-- Name: fa_records_period_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX fa_records_period_idx ON public.fa_records USING btree (period, status);


--
-- Name: fa_records_search_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX fa_records_search_trgm ON public.fa_records USING gin (search_text public.gin_trgm_ops);


--
-- Name: fa_records_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX fa_records_status_idx ON public.fa_records USING btree (status);


--
-- Name: ledgers_head_uq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX ledgers_head_uq ON public.ledgers USING btree (lower((expense_head)::text));


--
-- Name: login_attempts_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX login_attempts_user_idx ON public.login_attempts USING btree (user_id, attempt_id);


--
-- Name: lwm_tally_book_month_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX lwm_tally_book_month_idx ON public.lwm_tally USING btree (book_month);


--
-- Name: month_events_month_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX month_events_month_idx ON public.month_events USING btree (book_month, event_id);


--
-- Name: products_name_uq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX products_name_uq ON public.products USING btree (lower((product_name)::text));


--
-- Name: qty_lines_against_asset_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX qty_lines_against_asset_idx ON public.qty_lines USING btree (lower(TRIM(BOTH FROM against_asset_code))) WHERE (product_amount < (0)::numeric);


--
-- Name: qty_lines_fa_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX qty_lines_fa_idx ON public.qty_lines USING btree (fa_id, line_no);


--
-- Name: qty_locks_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX qty_locks_user_idx ON public.qty_locks USING btree (user_id);


--
-- Name: sessions_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX sessions_user_idx ON public.sessions USING btree (user_id);


--
-- Name: users_username_uq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX users_username_uq ON public.users USING btree (lower((username)::text));


--
-- Name: fa_records fa_records_book_month_trg; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER fa_records_book_month_trg BEFORE INSERT OR UPDATE OF book_month ON public.fa_records FOR EACH ROW EXECUTE FUNCTION public.fa_records_book_month();


--
-- Name: fa_records fa_records_search_trg; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER fa_records_search_trg BEFORE INSERT OR UPDATE ON public.fa_records FOR EACH ROW EXECUTE FUNCTION public.fa_records_search_text();


--
-- Name: lwm_tally lwm_tally_book_month_trg; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER lwm_tally_book_month_trg BEFORE INSERT ON public.lwm_tally FOR EACH ROW EXECUTE FUNCTION public.lwm_tally_book_month();


--
-- Name: login_attempts login_attempts_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.login_attempts
    ADD CONSTRAINT login_attempts_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(user_id) ON DELETE CASCADE;


--
-- Name: month_events month_events_book_month_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.month_events
    ADD CONSTRAINT month_events_book_month_fkey FOREIGN KEY (book_month) REFERENCES public.month_periods(book_month);


--
-- Name: month_snapshots month_snapshots_book_month_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.month_snapshots
    ADD CONSTRAINT month_snapshots_book_month_fkey FOREIGN KEY (book_month) REFERENCES public.month_periods(book_month);


--
-- Name: qty_lines_archive qty_lines_archive_fa_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.qty_lines_archive
    ADD CONSTRAINT qty_lines_archive_fa_id_fkey FOREIGN KEY (fa_id) REFERENCES public.fa_records_archive(fa_id) ON DELETE CASCADE;


--
-- Name: qty_lines qty_lines_fa_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.qty_lines
    ADD CONSTRAINT qty_lines_fa_id_fkey FOREIGN KEY (fa_id) REFERENCES public.fa_records(fa_id) ON DELETE CASCADE;


--
-- Name: qty_locks qty_locks_fa_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.qty_locks
    ADD CONSTRAINT qty_locks_fa_id_fkey FOREIGN KEY (fa_id) REFERENCES public.fa_records(fa_id) ON DELETE CASCADE;


--
-- Name: qty_locks qty_locks_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.qty_locks
    ADD CONSTRAINT qty_locks_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(user_id) ON DELETE CASCADE;


--
-- Name: sessions sessions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sessions
    ADD CONSTRAINT sessions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(user_id) ON DELETE CASCADE;


--
-- PostgreSQL database dump complete
--

\unrestrict ugvrFZRshTzAEkciRYOFTSaYr2yUcR4hPe5B8lbpviA9X239GEW7id3vSPhG8kn


-- applied database changes
--
-- PostgreSQL database dump
--

\restrict mxRAIQJqZSxShKYwVmv9IDZrvitb8TDBKr9oCFYGNS1Yj0FHFl6Rd5SnJiqlxsp

-- Dumped from database version 18.6
-- Dumped by pg_dump version 18.6

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Data for Name: schema_migrations; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.schema_migrations VALUES ('003_month_periods.sql', '2026-10-16 14:53:37.890031', NULL);
INSERT INTO public.schema_migrations VALUES ('001_initial.sql', '2026-10-15 13:35:19.027607', '927c767abbdbf6e7f7aa635b0e7ae3eb924eae5590fff6ad263c5ba40bbc9ba4');
INSERT INTO public.schema_migrations VALUES ('002_single_session.sql', '2026-10-15 19:08:11.291362', '61ff332eb756835094f11ec4984c3cf140a9fec363a67fa1d8f21f29e1d2e20f');
INSERT INTO public.schema_migrations VALUES ('003_month_close.sql', '2026-10-16 16:38:04.162393', '649dd5d4d0aae4356dfacf9343eb048c2e4b8f93ea49fcbad20689357ce28966');
INSERT INTO public.schema_migrations VALUES ('004_qty_locks.sql', '2026-10-16 17:02:25.528796', '617ad1156bb7c4e8bd35769809110d4d0bd64ca91ff956b67702453914b588cb');
INSERT INTO public.schema_migrations VALUES ('005_performance.sql', '2026-10-16 20:04:40.185091', '6c2ef446942514fba24aa9cb363a07d48be86535b2995e6a4c1d755d65734df7');
INSERT INTO public.schema_migrations VALUES ('006_login_block.sql', '2026-10-21 11:13:23.331838', '22b84513cb443a44175b8b2dbdb2647357ff1fb8bfc92318f443b80ca301eafc');
INSERT INTO public.schema_migrations VALUES ('007_year_end_archive.sql', '2026-10-21 13:18:31.057659', 'ac7796c9a4aad1c36b9d472694a8a07fe27e57075978b51b5618b23df5cdd311');
INSERT INTO public.schema_migrations VALUES ('008_app_releases.sql', '2026-10-21 13:18:31.078213', 'a39a95f300ff9086c6dff0b6aa004cad233a4617ba800ddf094a8e2631d0a944');
INSERT INTO public.schema_migrations VALUES ('009_search_index.sql', '2026-10-21 13:18:31.100181', 'e5c407c94fab821dbc59ac5361b555522caa5f4a52ddecc0bb4995bf342cb461');


--
-- PostgreSQL database dump complete
--

\unrestrict mxRAIQJqZSxShKYwVmv9IDZrvitb8TDBKr9oCFYGNS1Yj0FHFl6Rd5SnJiqlxsp

