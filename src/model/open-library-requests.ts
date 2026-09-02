import { ISBN10, ISBN13 } from "./isbn";

interface BaseThingsRequest {
    type: string;
}

interface BaseResponse {
    status: string;
    result: any;
}

interface WithIsbn10 extends BaseThingsRequest {
    isbn_10: ISBN10;
    isbn_13?: never;
}

interface WithIsbn13 extends BaseThingsRequest {
    isbn_13: ISBN13;
    isbn_10?: never;
}

interface GetObjectResponse extends BaseResponse {
    status: string;
    result: GetObjectResponseResult;
}

interface KeyReference {
    key: string;
}

interface GetObjectResponseResult {
    subject_place: string;
    lc_classifications: string;
    latest_revision: number;
    genres: Array<string>;
    title: string;
    languages: Array<KeyReference>;
    subjects: Array<string>;
    publish_country: string;
    by_statement: string;
    type: KeyReference;
    revision: number;
    publishers: Array<string>;
    last_modified: string;
    key: string;
    authors: Array<KeyReference>;
    publish_places: Array<string>;
    pagination: string;
    lccn: Array<string>;
    notes: string;
    number_of_pages: number;
    isbn_10: Array<string>;
    publish_date: string;
}

interface ThingsResponse extends BaseResponse {
    result: Array<string>
}

type ThingsRequest = WithIsbn10 | WithIsbn13

export type{
    ThingsRequest,
    GetObjectResponse,
};