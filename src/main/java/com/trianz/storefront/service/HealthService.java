package com.trianz.storefront.service;

import org.springframework.stereotype.Service;

/** Encapsulates the application's health-status logic. */
@Service
public class HealthService {

    public String status() {
        return "ok";
    }
}
