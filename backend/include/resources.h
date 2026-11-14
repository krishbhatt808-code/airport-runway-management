#pragma once
#include "minijson.h"

using namespace std;

typedef vector<long long> Vec;
typedef vector<Vec> Mat;

struct State {
    Vec available;
    Mat allocation, maxDemand, request;
};

// Reads a JSON array of integers into a vector; returns an error message or "".
inline string readVec(const Json& j, Vec& out) {
    if (j.type != Json::Arr) {
        return "expected an array of integers";
    }
    for (const Json& x : j.arr) {
        if (!x.isInt()) {
            return "vector entries must be integers";
        }
        out.push_back((long long)x.num);
    }
    return "";
}

// Reads a JSON array of arrays into a matrix; returns an error message or "".
inline string readMat(const Json& j, Mat& out) {
    if (j.type != Json::Arr) {
        return "expected a matrix (array of arrays)";
    }
    for (const Json& row : j.arr) {
        Vec v;
        string error = readVec(row, v);
        if (!error.empty()) {
            return error;
        }
        out.push_back(v);
    }
    return "";
}

// Returns the process names from the input, or P0, P1, ... when they are not given.
inline vector<string> readNames(const Json& in, size_t n) {
    bool given = in.has("processes") && in.at("processes").type == Json::Arr && in.at("processes").arr.size() == n;
    vector<string> names;
    for (size_t i = 0; i < n; i++) {
        names.push_back(given ? in.at("processes").arr[i].str : "P" + to_string(i));
    }
    return names;
}

// Returns true when no entry of the vector is negative.
inline bool nonNegative(const Vec& v) {
    for (long long x : v) {
        if (x < 0) {
            return false;
        }
    }
    return true;
}

// Returns true when every entry of a is less than or equal to the same entry of b.
inline bool leq(const Vec& a, const Vec& b) {
    for (size_t i = 0; i < a.size(); i++) {
        if (a[i] > b[i]) {
            return false;
        }
    }
    return true;
}

// Adds vector b to vector a entry by entry.
inline void addTo(Vec& a, const Vec& b) {
    for (size_t i = 0; i < a.size(); i++) {
        a[i] += b[i];
    }
}

// Subtracts vector b from vector a entry by entry.
inline void subFrom(Vec& a, const Vec& b) {
    for (size_t i = 0; i < a.size(); i++) {
        a[i] -= b[i];
    }
}

// Checks that the matrix has n rows, m columns and no negative values; returns an error message or "".
inline string checkShape(const Mat& mat, size_t n, size_t m, const string& name) {
    if (mat.size() != n) {
        return name + " must have one row per process";
    }
    for (const Vec& row : mat) {
        if (row.size() != m) {
            return name + " rows must have one column per resource type";
        }
        if (!nonNegative(row)) {
            return name + " must not contain negative values";
        }
    }
    return "";
}